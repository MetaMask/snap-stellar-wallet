import type { KeyringEventPayload } from '@metamask/keyring-api';
import { KeyringEvent } from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import type { SnapsProvider } from '@metamask/snaps-sdk';
import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { KnownCaip19Sep41AssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from './__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from './OnChainAccount';
import { OnChainAccountRepository } from './OnChainAccountRepository';
import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import { bufferToUint8Array } from '../../utils/buffer';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import {
  NATIVE,
  USDC_CLASSIC,
  USDT_SEP41,
  USDC_SEP41,
  generateMockStellarAssetMetadata,
} from '../asset-metadata/__mocks__/assets.fixtures';
import type { StellarAssetMetadata } from '../asset-metadata/api';
import { AssetMetadataService } from '../asset-metadata/AssetMetadataService';
import { AccountNotActivatedException, NetworkService } from '../network';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
}));

/**
 * Simulates persisted `onChainAccounts` data the repository reads via `findByKeyringAccountIds`:
 * `latest` moves forward on each `saveSnapshot`; one find invocation can read a frozen post–first-save
 * snapshot (stale client baseline while snap state is ahead).
 *
 * @param params
 * @param params.primaryKeyringId
 * @param params.staleReadOnFindInvocation
 */
function createPersistedOnChainAccountStateStoreSimulator(params: {
  primaryKeyringId: string;
  /** 1-based count of `findByKeyringAccountIds` invocations when the frozen first-save snapshot is returned. */
  staleReadOnFindInvocation: number;
}) {
  const { primaryKeyringId, staleReadOnFindInvocation } = params;
  let latest: OnChainAccountSerializableFull | null = null;
  let afterFirstSave: OnChainAccountSerializableFull | null = null;
  let saveCount = 0;
  let findInvocation = 0;

  return {
    /**
     * Call after each successful `saveMany` payload (mirrors snap state holding `onChainAccounts`).
     *
     * @param serializedAccount
     */
    saveSnapshot(serializedAccount: OnChainAccountSerializableFull) {
      saveCount += 1;
      latest = JSON.parse(
        JSON.stringify(serializedAccount),
      ) as OnChainAccountSerializableFull;
      if (saveCount === 1) {
        afterFirstSave = JSON.parse(
          JSON.stringify(serializedAccount),
        ) as OnChainAccountSerializableFull;
      }
    },

    /**
     * Mimics {@link OnChainAccountRepository.findByKeyringAccountIds} for the simulated store.
     *
     * @param keyringAccountIds
     */
    findByKeyringAccountIds(
      keyringAccountIds: string[],
    ): Record<string, OnChainAccountSerializableFull | null> {
      findInvocation += 1;
      const out: Record<string, OnChainAccountSerializableFull | null> = {};
      for (const id of keyringAccountIds) {
        if (id !== primaryKeyringId) {
          out[id] = null;
          continue;
        }
        if (findInvocation === 1) {
          out[id] = null;
        } else if (findInvocation === staleReadOnFindInvocation) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- first save precedes this find
          out[id] = afterFirstSave!;
        } else {
          out[id] = latest;
        }
      }
      return out;
    },
  };
}

describe('OnChainAccountSynchronizeService', () => {
  const seed = hexToBytes(
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  );
  const sep41Id = USDC_SEP41 as KnownCaip19Sep41AssetId;
  const backupSep41Id = USDT_SEP41 as KnownCaip19Sep41AssetId;

  const getNetworkServiceSpies = () => ({
    loadOnChainAccountSpy: jest.spyOn(
      NetworkService.prototype,
      'loadOnChainAccount',
    ),
    getSep41AssetBalancesSpy: jest.spyOn(
      NetworkService.prototype,
      'getSep41AssetBalances',
    ),
  });

  const getRepositorySpies = (
    onChainAccountRepository: ReturnType<
      typeof mockOnChainAccountService
    >['onChainAccountRepository'],
  ) => ({
    findByKeyringAccountIdsSpy: jest.spyOn(
      onChainAccountRepository,
      'findByKeyringAccountIds',
    ),
    saveManySpy: jest.spyOn(onChainAccountRepository, 'saveMany'),
  });

  const getKeyringEventSpies = () => ({
    emitSnapKeyringEventSpy: jest.mocked(emitSnapKeyringEvent),
  });

  const setupSynchronizeService = () => {
    const { onChainAccountService, onChainAccountRepository } =
      mockOnChainAccountService();
    return {
      onChainAccountService,
      onChainAccountRepository,
      ...getRepositorySpies(onChainAccountRepository),
    };
  };

  const getSavedSnapshotFromFirstSave = (
    saveManySpy: ReturnType<typeof getRepositorySpies>['saveManySpy'],
    keyringAccountId: string,
  ): OnChainAccountSerializableFull => {
    expect(saveManySpy).toHaveBeenCalledTimes(1);
    expect(saveManySpy.mock.calls[0]).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- narrowed by expect above
    const payload = saveManySpy.mock.calls[0]![0];
    return payload[keyringAccountId] as OnChainAccountSerializableFull;
  };

  const getOnChainAccountServiceSpies = () => ({
    setAssetSpy: jest.spyOn(OnChainAccount.prototype, 'setAsset'),
  });

  const setupTest = () => {
    jest.mocked(emitSnapKeyringEvent).mockResolvedValue(undefined);
    const metadata = generateMockStellarAssetMetadata();
    const usdcSep41Row = metadata[USDC_SEP41];
    if (!usdcSep41Row) {
      throw new Error('expected USDC_SEP41 in mock asset metadata');
    }
    const usdtSep41Row = metadata[USDT_SEP41];
    if (!usdtSep41Row) {
      throw new Error('expected USDT_SEP41 in mock asset metadata');
    }
    jest
      .spyOn(AssetMetadataService.prototype, 'getPersistedSep41AssetsMetadata')
      .mockResolvedValue([usdcSep41Row, usdtSep41Row]);
    // getKey('assets') in tests does not merge defaultState, so getAllByScope is empty unless mocked.
    jest
      .spyOn(AssetMetadataService.prototype, 'getAllByScope')
      .mockImplementation(async (scope) => {
        const byAssetId = generateMockStellarAssetMetadata();
        return Object.values(byAssetId).filter(
          (asset): asset is StellarAssetMetadata =>
            asset !== undefined && asset.chainId === scope,
        );
      });
  };

  const setupOnChainAccountWithBalance = (entropySource: string) => {
    const signer = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
    const keyringAccount = generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      signer.publicKey(),
      entropySource,
      0,
    );
    const loadedAcc = createMockAccountWithBalances(
      signer.publicKey(),
      '1',
      DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
    );
    const binding = horizonSource(
      loadedAcc,
      KnownCaip2ChainId.Mainnet,
    ) as OnChainAccountSerializableFull;
    const onChainAccount = OnChainAccount.fromSerializable(binding);

    return {
      signer,
      keyringAccount,
      binding,
      onChainAccount,
    };
  };

  it('returns early without saveMany when accountsPairs is empty', async () => {
    setupTest();

    const { onChainAccountService, saveManySpy } = setupSynchronizeService();

    await onChainAccountService.synchronize([], KnownCaip2ChainId.Mainnet);

    expect(saveManySpy).not.toHaveBeenCalled();
  });

  it('returns early when no activated account is loaded', async () => {
    setupTest();

    const keyringAccount = generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      Keypair.random().publicKey(),
      'entropy-sync-no-activated',
      0,
    );
    const { loadOnChainAccountSpy, getSep41AssetBalancesSpy } =
      getNetworkServiceSpies();
    loadOnChainAccountSpy.mockRejectedValue(
      new AccountNotActivatedException(
        keyringAccount.address,
        KnownCaip2ChainId.Mainnet,
      ),
    );

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, findByKeyringAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(getSep41AssetBalancesSpy).not.toHaveBeenCalled();
    expect(findByKeyringAccountIdsSpy).not.toHaveBeenCalled();
    expect(saveManySpy).not.toHaveBeenCalled();
    expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
  });

  it('persists SEP-41 balances after sync and writes onChainAccounts state', async () => {
    setupTest();

    const { signer, keyringAccount, onChainAccount } =
      setupOnChainAccountWithBalance('entropy-sync-1');
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber('1000'),
      },
    });
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { onChainAccountService, saveManySpy } = setupSynchronizeService();

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    const saved = getSavedSnapshotFromFirstSave(saveManySpy, keyringAccount.id);
    expect(saved).toBeDefined();
    const sepRow = saved.balances.find((b) => b.assetId === sep41Id);
    expect(sepRow?.balance).toBe('1000');
  });

  it('emits AccountBalancesUpdated and AccountAssetListUpdated when SEP-41 is added versus persisted state', async () => {
    setupTest();
    const metadata = generateMockStellarAssetMetadata();
    const usdcSep41Row = metadata[USDC_SEP41];
    const usdtSep41Row = metadata[USDT_SEP41];
    expect(usdcSep41Row).toBeDefined();
    expect(usdtSep41Row).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by expects above
    const assuredUsdcSep41Row = usdcSep41Row!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by expects above
    const assuredUsdtSep41Row = usdtSep41Row!;
    assuredUsdcSep41Row.units = [
      { ...assuredUsdcSep41Row.units[0], decimals: 2 },
    ];
    jest
      .spyOn(AssetMetadataService.prototype, 'getPersistedSep41AssetsMetadata')
      .mockResolvedValue([assuredUsdcSep41Row, assuredUsdtSep41Row]);

    const { signer, keyringAccount, binding } =
      setupOnChainAccountWithBalance('entropy-sync-2');
    const withSep: OnChainAccountSerializableFull = {
      ...binding,
      balances: [
        ...binding.balances,
        { assetId: sep41Id, balance: '500', symbol: 'USDC', decimals: 2 },
      ],
    };
    const onChainAccount = OnChainAccount.fromSerializable(withSep);

    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber('500'),
      },
    });
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, findByKeyringAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByKeyringAccountIdsSpy.mockResolvedValue({
      [keyringAccount.id]: binding,
    });

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(emitSnapKeyringEventSpy).toHaveBeenCalledTimes(2);
    expect(emitSnapKeyringEventSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      KeyringEvent.AccountBalancesUpdated,
      expect.objectContaining({
        balances: {
          [keyringAccount.id]: expect.objectContaining({
            [sep41Id]: { unit: 'USDC', amount: '5' },
          }),
        },
      }),
    );
    expect(emitSnapKeyringEventSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      KeyringEvent.AccountAssetListUpdated,
      {
        assets: {
          [keyringAccount.id]: { added: [sep41Id], removed: [] },
        },
      },
    );
    expect(saveManySpy).toHaveBeenCalled();
    expect(saveManySpy.mock.invocationCallOrder).toHaveLength(1);
    expect(emitSnapKeyringEventSpy.mock.invocationCallOrder).toHaveLength(2);
    expect(Number(saveManySpy.mock.invocationCallOrder[0])).toBeLessThan(
      Number(emitSnapKeyringEventSpy.mock.invocationCallOrder[0]),
    );
  });

  it('keeps SEP-41 persisted with zero balance when new sync returns zero', async () => {
    setupTest();

    const {
      signer,
      keyringAccount,
      binding: base,
      onChainAccount,
    } = setupOnChainAccountWithBalance('entropy-sync-3');
    const withSep: OnChainAccountSerializableFull = {
      ...base,
      balances: [
        ...base.balances,
        { assetId: sep41Id, balance: '200', symbol: 'USDC', decimals: 7 },
      ],
    };
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber(0),
      },
    });

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, findByKeyringAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByKeyringAccountIdsSpy.mockResolvedValue({
      [keyringAccount.id]: withSep,
    });
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(emitSnapKeyringEventSpy).toHaveBeenCalledTimes(2);
    expect(emitSnapKeyringEventSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      KeyringEvent.AccountBalancesUpdated,
      expect.objectContaining({
        balances: {
          [keyringAccount.id]: expect.objectContaining({
            [sep41Id]: { unit: 'USDC', amount: '0' },
          }),
        },
      }),
    );
    expect(emitSnapKeyringEventSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      KeyringEvent.AccountAssetListUpdated,
      {
        assets: {
          [keyringAccount.id]: { added: [], removed: [sep41Id] },
        },
      },
    );
    const saved = getSavedSnapshotFromFirstSave(saveManySpy, keyringAccount.id);
    const sep41Row = saved.balances.find((b) => b.assetId === sep41Id);
    expect(sep41Row?.balance).toBe('0');
  });

  it('still emits SEP-41 zero balance on later syncs after missed events', async () => {
    setupTest();

    const { signer, keyringAccount, binding } = setupOnChainAccountWithBalance(
      'entropy-sync-sep41-zero-replay',
    );
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    loadOnChainAccountSpy.mockImplementation(async () =>
      OnChainAccount.fromSerializable(binding),
    );
    getSep41AssetBalancesSpy
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber('500'),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      });

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService } = setupSynchronizeService();

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    const balanceEventCalls = emitSnapKeyringEventSpy.mock.calls.filter(
      (call) => call[1] === KeyringEvent.AccountBalancesUpdated,
    );
    expect(balanceEventCalls).toHaveLength(4);
    expect(balanceEventCalls[3]?.[2]).toStrictEqual(
      expect.objectContaining({
        balances: {
          [keyringAccount.id]: expect.objectContaining({
            [sep41Id]: { unit: 'USDC', amount: '0' },
          }),
        },
      }),
    );
  });

  it('simulates client receiving sync 1 and 4 while missing 2 and 3 with trustline removal and SEP-41 zero', async () => {
    setupTest();

    const {
      signer,
      keyringAccount,
      binding: baseBinding,
    } = setupOnChainAccountWithBalance('entropy-sync-client-sim-1-4');
    const usdcClassicIssuer = USDC_CLASSIC.split('-').at(1) as string;

    const withTrustlineBinding = horizonSource(
      createMockAccountWithBalances(signer.publicKey(), '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'USDC',
            assetIssuer: usdcClassicIssuer,
            balance: 25,
          },
        ],
      }),
      KnownCaip2ChainId.Mainnet,
    ) as OnChainAccountSerializableFull;
    const onChainAccountWithTrustline =
      OnChainAccount.fromSerializable(withTrustlineBinding);
    const cloneBaseBinding = (): OnChainAccountSerializableFull =>
      JSON.parse(JSON.stringify(baseBinding)) as OnChainAccountSerializableFull;

    let persistedSnapshot: OnChainAccountSerializableFull | null = null;

    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    loadOnChainAccountSpy
      .mockResolvedValueOnce(onChainAccountWithTrustline)
      .mockImplementation(async () =>
        OnChainAccount.fromSerializable(cloneBaseBinding()),
      );
    getSep41AssetBalancesSpy
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber('500'),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      })
      .mockResolvedValueOnce({
        [signer.publicKey()]: {
          [sep41Id]: new BigNumber(0),
        },
      });

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, saveManySpy, onChainAccountRepository } =
      setupSynchronizeService();

    jest
      .spyOn(onChainAccountRepository, 'findByKeyringAccountIds')
      .mockImplementation(async (keyringAccountIds: string[]) => {
        const out: Record<string, OnChainAccountSerializableFull | null> = {};
        for (const id of keyringAccountIds) {
          out[id] = persistedSnapshot;
        }
        return out;
      });

    const saveManyInner = OnChainAccountRepository.prototype.saveMany.bind(
      onChainAccountRepository,
    );
    /* eslint-disable jest/no-conditional-in-test -- mock tracks last snapshot for findByKeyringAccountIds */
    saveManySpy.mockImplementation(async (accounts) => {
      const next = accounts[keyringAccount.id];
      if (next) {
        persistedSnapshot = JSON.parse(
          JSON.stringify(next),
        ) as OnChainAccountSerializableFull;
      }
      await saveManyInner(accounts);
    });
    /* eslint-enable jest/no-conditional-in-test */

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    ); // sync 1
    const afterSync1 = saveManySpy.mock.calls[0]?.[0]?.[keyringAccount.id];
    expect(
      afterSync1?.balances.find((b) => b.assetId === USDC_CLASSIC),
    ).toBeDefined();

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    ); // sync 2 (missed by client)
    expect(saveManySpy.mock.calls).toHaveLength(2);
    const afterSync2 = saveManySpy.mock.calls[1]?.[0]?.[keyringAccount.id];
    const classicAfterRemoval = afterSync2?.balances.find(
      (b) => b.assetId === USDC_CLASSIC,
    );
    expect(classicAfterRemoval).toStrictEqual(
      expect.objectContaining({
        assetId: USDC_CLASSIC,
        limit: '0',
        balance: '0',
      }),
    );

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    ); // sync 3 (missed by client)
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    ); // sync 4

    const balanceEventCalls = emitSnapKeyringEventSpy.mock.calls
      .filter((call) => call[1] === KeyringEvent.AccountBalancesUpdated)
      .map((call) => call[2]);
    expect(balanceEventCalls).toHaveLength(4);
    const sync1Payload = balanceEventCalls[0] as {
      balances: Record<
        string,
        Record<string, { amount: string; unit: string }>
      >;
    };
    const sync4Payload = balanceEventCalls[3] as {
      balances: Record<
        string,
        Record<string, { amount: string; unit: string }>
      >;
    };

    const simulatedClientBalances: Record<
      string,
      { amount: string; unit: string }
    > = {};

    // Client receives sync 1.
    Object.assign(
      simulatedClientBalances,
      sync1Payload.balances[keyringAccount.id] as Record<
        string,
        { amount: string; unit: string }
      >,
    );
    expect(simulatedClientBalances[USDC_CLASSIC]?.amount).toBe('25');
    expect(simulatedClientBalances[sep41Id]?.amount).toBe('0.00005');

    // Client misses sync 2 and 3.

    // Client receives sync 4 and catches up.
    Object.assign(
      simulatedClientBalances,
      sync4Payload.balances[keyringAccount.id] as Record<
        string,
        { amount: string; unit: string }
      >,
    );
    // Trustline removal happened on sync 2 and was missed by client.
    // Classic removals persist as tombstone entries (`limit` 0), so sync 4 still sends balance 0.
    expect(simulatedClientBalances[USDC_CLASSIC]?.amount).toBe('0');
    // SEP-41 zero entries are persisted and continue to be sent, so sync 4 corrects the client.
    expect(simulatedClientBalances[sep41Id]).toStrictEqual({
      unit: 'USDC',
      amount: '0',
    });
  });

  it('runs four syncs with emit failures then full balance and asset-list reconciliation', async () => {
    setupTest();

    const {
      signer,
      keyringAccount,
      onChainAccount: onChainAccountNoClassic,
    } = setupOnChainAccountWithBalance('entropy-sync-four-phase-reconcile');
    const usdcClassicIssuer = USDC_CLASSIC.split('-').at(1) as string;

    const withUsdcZeroBinding = horizonSource(
      createMockAccountWithBalances(signer.publicKey(), '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'USDC',
            assetIssuer: usdcClassicIssuer,
            balance: 0,
          },
        ],
      }),
      KnownCaip2ChainId.Mainnet,
    ) as OnChainAccountSerializableFull;
    const onChainAccountUsdcZero =
      OnChainAccount.fromSerializable(withUsdcZeroBinding);

    const withEurcBinding = horizonSource(
      createMockAccountWithBalances(signer.publicKey(), '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'EURC',
            assetIssuer: usdcClassicIssuer,
            balance: 10,
          },
        ],
      }),
      KnownCaip2ChainId.Mainnet,
    ) as OnChainAccountSerializableFull;
    const eurcClassicRow = withEurcBinding.balances.find(
      (b) => b.assetId !== NATIVE,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- EURC is the only non-native entry
    const EURC_CLASSIC = eurcClassicRow!.assetId;
    const onChainAccountEurcOnly =
      OnChainAccount.fromSerializable(withEurcBinding);

    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    // simulate the OnChain data:
    // 1) Add USDC trustline at 0 balance — emits succeed.
    // 2) Remove USDC on Horizon — balance emit fails (client misses removal).
    // 3) Add EURC trustline with 10 — balance emit fails (client misses add).
    // 4) No ledger change — balance + asset emits succeed.
    loadOnChainAccountSpy
      .mockResolvedValueOnce(onChainAccountUsdcZero)
      .mockResolvedValueOnce(onChainAccountNoClassic)
      .mockResolvedValue(onChainAccountEurcOnly);

    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber(0),
      },
    });

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const {
      onChainAccountService,
      saveManySpy,
      findByKeyringAccountIdsSpy,
      onChainAccountRepository,
    } = setupSynchronizeService();

    const persistedSnapState = createPersistedOnChainAccountStateStoreSimulator(
      {
        primaryKeyringId: keyringAccount.id,
        staleReadOnFindInvocation: 4,
      },
    );

    // `findByKeyringAccountIds` reads persisted `onChainAccounts`; this mirrors that store so we
    // do not hand-chain `mockResolvedValueOnce` per sync. `saveMany` still persists to the real test State.
    findByKeyringAccountIdsSpy.mockImplementation(async (keyringAccountIds) =>
      Promise.resolve(
        persistedSnapState.findByKeyringAccountIds(keyringAccountIds),
      ),
    );

    const saveManyInner = OnChainAccountRepository.prototype.saveMany.bind(
      onChainAccountRepository,
    );
    saveManySpy.mockImplementation(async (accounts) => {
      const next = accounts[keyringAccount.id];
      const clone = JSON.parse(
        JSON.stringify(next),
      ) as OnChainAccountSerializableFull;
      persistedSnapState.saveSnapshot(clone);
      await saveManyInner(accounts);
    });

    // 1) Add USDC trustline at 0 balance — emits succeed.
    // 2) Remove USDC on Horizon — balance emit fails (client misses removal).
    // 3) Add EURC trustline with 10 — balance emit fails (client misses add).
    // 4) No ledger change — balance + asset emits succeed. The 4th `find` uses the simulator's
    //    `staleReadOnFindInvocation` so the baseline is post–sync-1 while `latest` is already ahead.
    // Emit queue: sync1 balance + asset succeed; sync2 and sync3 fail on balance only; then succeed.
    emitSnapKeyringEventSpy
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('client handler unavailable'))
      .mockRejectedValueOnce(new Error('client handler unavailable'))
      .mockResolvedValue(undefined);

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );
    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(saveManySpy).toHaveBeenCalledTimes(4);
    expect(emitSnapKeyringEventSpy).toHaveBeenCalledTimes(6);

    const balanceCalls = emitSnapKeyringEventSpy.mock.calls.filter(
      (call) => call[1] === KeyringEvent.AccountBalancesUpdated,
    );
    expect(balanceCalls).toHaveLength(4);

    const accountBalancesFromNthBalanceEmit = (
      nthZeroBased: number,
    ): KeyringEventPayload<KeyringEvent.AccountBalancesUpdated>['balances'] => {
      const [, , payload] = balanceCalls[nthZeroBased] as [
        SnapsProvider,
        KeyringEvent.AccountBalancesUpdated,
        KeyringEventPayload<KeyringEvent.AccountBalancesUpdated>,
      ];
      const row = payload.balances[keyringAccount.id];
      expect(row).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- narrowed by expect above
      return row!;
    };

    // 1st `AccountBalancesUpdated` (after sync 1): USDC trustline at 0 + full snapshot.
    expect(accountBalancesFromNthBalanceEmit(0)).toMatchObject({
      [USDC_CLASSIC]: { unit: 'USDC', amount: '0' },
    });

    // 2nd `AccountBalancesUpdated` (after sync 2): USDC removed on Horizon → tombstone balance 0 in payload.
    expect(accountBalancesFromNthBalanceEmit(1)).toMatchObject({
      [USDC_CLASSIC]: { unit: 'USDC', amount: '0' },
    });

    // 3rd `AccountBalancesUpdated` (after sync 3): EURC added on Horizon + USDC tombstone still in snapshot.
    expect(accountBalancesFromNthBalanceEmit(2)).toMatchObject({
      [USDC_CLASSIC]: { unit: 'USDC', amount: '0' },
      [EURC_CLASSIC]: { unit: 'EURC', amount: '10' },
    });

    // 4th `AccountBalancesUpdated` (after sync 4): same on-chain entries as sync 3, but `find` read a stale
    // baseline so asset-list deltas fire; balances stay a full per-asset map (native + SEP-41 + classics).
    const fourthBalanceSnapshot = accountBalancesFromNthBalanceEmit(3);
    expect(Object.keys(fourthBalanceSnapshot).length).toBeGreaterThan(2);
    expect(fourthBalanceSnapshot).toMatchObject({
      [USDC_CLASSIC]: { unit: 'USDC', amount: '0' },
      [EURC_CLASSIC]: { unit: 'EURC', amount: '10' },
    });

    const assetListCalls = emitSnapKeyringEventSpy.mock.calls.filter(
      (call) => call[1] === KeyringEvent.AccountAssetListUpdated,
    );
    expect(assetListCalls).toHaveLength(2);

    const assetListDeltaFromNthAssetEmit = (
      nthZeroBased: number,
    ): KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>['assets'][string] => {
      const [, , payload] = assetListCalls[nthZeroBased] as [
        SnapsProvider,
        KeyringEvent.AccountAssetListUpdated,
        KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>,
      ];
      const row = payload.assets[keyringAccount.id];
      expect(row).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- narrowed by expect above
      return row!;
    };

    // 1st `AccountAssetListUpdated` (after sync 1): USDC trustline becomes visible (limit > 0, balance 0).
    expect(assetListDeltaFromNthAssetEmit(0)).toStrictEqual({
      added: [USDC_CLASSIC],
      removed: [],
    });

    // 2nd `AccountAssetListUpdated` (after sync 4): stale baseline vs current → EURC added, USDC removed from list.
    expect(assetListDeltaFromNthAssetEmit(1)).toStrictEqual({
      added: [EURC_CLASSIC],
      removed: [USDC_CLASSIC],
    });
  });

  it('does not restore SEP-41 entries when SEP-41 balance fetch fails and no persisted snapshot is found', async () => {
    setupTest();

    const { keyringAccount, onChainAccount } = setupOnChainAccountWithBalance(
      'entropy-sync-fallback-all-fail',
    );
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockRejectedValue(
      new Error('sep41 fetch temporarily unavailable'),
    );
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { setAssetSpy } = getOnChainAccountServiceSpies();
    const { onChainAccountService, findByKeyringAccountIdsSpy } =
      setupSynchronizeService();
    // Mock no persisted snapshot is found for the account.
    findByKeyringAccountIdsSpy.mockResolvedValue({ [keyringAccount.id]: null });

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(setAssetSpy).not.toHaveBeenCalled();
  });

  it('restores persisted SEP-41 entries when SEP-41 balance fetch fails and still emits current balances', async () => {
    setupTest();

    const {
      keyringAccount,
      binding: base,
      onChainAccount,
    } = setupOnChainAccountWithBalance('entropy-sync-fallback-all-fail');
    const withPersistedSep41: OnChainAccountSerializableFull = {
      ...base,
      balances: [
        ...base.balances,
        { assetId: sep41Id, balance: '700', symbol: 'USDC', decimals: 7 },
      ],
    };
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockRejectedValue(
      new Error('sep41 fetch temporarily unavailable'),
    );
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, findByKeyringAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByKeyringAccountIdsSpy.mockResolvedValue({
      [keyringAccount.id]: withPersistedSep41,
    });

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    const saved = getSavedSnapshotFromFirstSave(saveManySpy, keyringAccount.id);
    const persistedSep41Row = saved.balances.find((b) => b.assetId === sep41Id);
    expect(persistedSep41Row?.balance).toBe('700');
    expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
      expect.anything(),
      KeyringEvent.AccountBalancesUpdated,
      expect.objectContaining({
        balances: {
          [keyringAccount.id]: expect.objectContaining({
            [sep41Id]: { unit: 'USDC', amount: '0.00007' },
          }),
        },
      }),
    );
  });

  it('restores unresolved persisted SEP-41 entries when only some SEP-41 balances fail', async () => {
    setupTest();

    const {
      signer,
      keyringAccount,
      binding: base,
      onChainAccount,
    } = setupOnChainAccountWithBalance('entropy-sync-fallback-some-fail');
    const withPersistedBackupSep41: OnChainAccountSerializableFull = {
      ...base,
      balances: [
        ...base.balances,
        {
          assetId: backupSep41Id,
          balance: '250',
          symbol: 'USDT',
          decimals: 7,
        },
      ],
    };
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber('500'),
        [backupSep41Id]: null,
      },
    });
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { onChainAccountService, findByKeyringAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByKeyringAccountIdsSpy.mockResolvedValue({
      [keyringAccount.id]: withPersistedBackupSep41,
    });

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    const saved = getSavedSnapshotFromFirstSave(saveManySpy, keyringAccount.id);
    const resolvedSep41Row = saved.balances.find((b) => b.assetId === sep41Id);
    const restoredSep41Row = saved.balances.find(
      (b) => b.assetId === backupSep41Id,
    );
    expect(resolvedSep41Row?.balance).toBe('500');
    expect(restoredSep41Row?.balance).toBe('250');
  });

  it('does not emit keyring events when saveMany fails', async () => {
    setupTest();

    const { signer, keyringAccount, onChainAccount } =
      setupOnChainAccountWithBalance('entropy-sync-1');
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockResolvedValue({
      [signer.publicKey()]: {
        [sep41Id]: new BigNumber('1000'),
      },
    });
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, saveManySpy } = setupSynchronizeService();
    saveManySpy.mockRejectedValue(new Error('saveMany failed'));

    await expect(
      onChainAccountService.synchronize(
        [keyringAccount],
        KnownCaip2ChainId.Mainnet,
      ),
    ).rejects.toThrow('saveMany failed');

    expect(saveManySpy).toHaveBeenCalled();
    expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
  });
});
