import { KeyringEvent } from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
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
import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import { bufferToUint8Array } from '../../utils/buffer';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import {
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

describe('OnChainAccountService.synchronize', () => {
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
    findByAccountIdsSpy: jest.spyOn(
      onChainAccountRepository,
      'findByAccountIds',
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
    const { onChainAccountService, findByAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    expect(getSep41AssetBalancesSpy).not.toHaveBeenCalled();
    expect(findByAccountIdsSpy).not.toHaveBeenCalled();
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

    const { signer, keyringAccount, binding } =
      setupOnChainAccountWithBalance('entropy-sync-2');
    const withSep: OnChainAccountSerializableFull = {
      ...binding,
      balances: [
        ...binding.balances,
        { assetId: sep41Id, balance: '500', symbol: 'USDC' },
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
    const { onChainAccountService, findByAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByAccountIdsSpy.mockResolvedValue({
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
      {
        balances: {
          [keyringAccount.id]: {
            [sep41Id]: { unit: 'USDC', amount: '500' },
          },
        },
      },
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

  it('emits removal when SEP-41 was persisted and new sync has zero', async () => {
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
        { assetId: sep41Id, balance: '200', symbol: 'USDC' },
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
    const { onChainAccountService, findByAccountIdsSpy } =
      setupSynchronizeService();
    findByAccountIdsSpy.mockResolvedValue({
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
      {
        balances: {
          [keyringAccount.id]: {
            [sep41Id]: { unit: 'USDC', amount: '0' },
          },
        },
      },
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
  });

  it('restores persisted SEP-41 rows when SEP-41 balance fetch fails', async () => {
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
        { assetId: sep41Id, balance: '700', symbol: 'USDC' },
      ],
    };
    const { getSep41AssetBalancesSpy, loadOnChainAccountSpy } =
      getNetworkServiceSpies();
    getSep41AssetBalancesSpy.mockRejectedValue(
      new Error('sep41 fetch temporarily unavailable'),
    );
    loadOnChainAccountSpy.mockResolvedValue(onChainAccount);

    const { emitSnapKeyringEventSpy } = getKeyringEventSpies();
    const { onChainAccountService, findByAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByAccountIdsSpy.mockResolvedValue({
      [keyringAccount.id]: withPersistedSep41,
    });

    await onChainAccountService.synchronize(
      [keyringAccount],
      KnownCaip2ChainId.Mainnet,
    );

    const saved = getSavedSnapshotFromFirstSave(saveManySpy, keyringAccount.id);
    const persistedSep41Row = saved.balances.find((b) => b.assetId === sep41Id);
    expect(persistedSep41Row?.balance).toBe('700');
    expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
  });

  it('restores unresolved persisted SEP-41 rows when only some SEP-41 balances fail', async () => {
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
        { assetId: backupSep41Id, balance: '250', symbol: 'USDT' },
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

    const { onChainAccountService, findByAccountIdsSpy, saveManySpy } =
      setupSynchronizeService();
    findByAccountIdsSpy.mockResolvedValue({
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
});
