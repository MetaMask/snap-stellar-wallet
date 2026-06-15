import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import {
  KeyringEvent,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import type { Horizon } from '@stellar/stellar-sdk';
import { Keypair, Networks } from '@stellar/stellar-sdk';

import { KnownCaip2ChainId } from '../../api';
import { sep41SendTransactionResponse } from './__mocks__/horizon-transaction-responses.fixtures';
import {
  buildMockClassicTransaction,
  generateMockTransactions,
} from './__mocks__/transaction.fixtures';
import { KeyringTransactionBuilder } from './KeyringTransactionBuilder';
import { Transaction } from './Transaction';
import { TransactionMapper } from './TransactionMapper';
import { TransactionRepository } from './TransactionRepository';
import { TransactionSynchronizeService } from './TransactionSynchronizeService';
import { toCaip19Sep41AssetId } from '../../utils';
import { logger } from '../../utils/logger';
import { getSnapProvider } from '../../utils/snap';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import type { AccountService } from '../account/AccountService';
import type { StellarAssetMetadata } from '../asset-metadata/api';
import { toStellarAssetMetadata } from '../asset-metadata/utils';
import { createMemoryCache } from '../cache/__mocks__/cache.fixtures';
import { NetworkService } from '../network';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
} from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import { State } from '../state/State';
import type { ActivatedAccountPair } from '../sync/api';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
}));

function buildOnChainPaymentTransaction(params: {
  sourceAddress: string;
  destinationAddress: string;
  amount: string;
}): Transaction {
  const { sourceAddress, destinationAddress, amount } = params;
  const built = buildMockClassicTransaction(
    [
      {
        type: 'payment',
        params: {
          destination: destinationAddress,
          asset: 'native',
          amount,
        },
      },
    ],
    {
      networkPassphrase: Networks.PUBLIC,
      source: { accountId: sourceAddress, sequence: '1' },
    },
  );
  const inner = built.getRaw();

  return Transaction.fromHorizon({
    horizonTransaction: {
      id: inner.hash().toString('hex'),
      hash: inner.hash().toString('hex'),
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
      envelope_xdr: inner.toXDR(),
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
      fee_charged: inner.fee,
      successful: true,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
      created_at: '2026-01-15T00:00:00.000Z',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
      paging_token: 'scan-token-1',
    } as Horizon.ServerApi.TransactionRecord,
    scope: KnownCaip2ChainId.Mainnet,
  });
}

describe('TransactionSynchronizeService', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const destinationAddress = Keypair.random().publicKey();
  const sep41SenderAddress =
    'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
  const sep41RecipientAddress =
    'GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU';
  const sep41AssetId = toCaip19Sep41AssetId(
    scope,
    'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN',
  );
  const sep41AssetMetadata: StellarAssetMetadata = toStellarAssetMetadata({
    assetId: sep41AssetId,
    decimals: 8,
    symbol: 'SolvBTC',
  });

  const setup = (params?: {
    allAccounts?: ReturnType<typeof generateStellarKeyringAccount>[];
  }) => {
    const { cache } = createMemoryCache();
    const networkService = new NetworkService({ logger, cache });
    const transactionRepository = new TransactionRepository(
      new State({
        encrypted: false,
        defaultState: {
          transactions: {},
          lastScanTokens: {},
        },
      }),
    );
    const transactionMapper = new TransactionMapper({
      keyringTransactionBuilder: new KeyringTransactionBuilder(),
      logger,
    });
    const accountService = {
      listAccountsByScope: jest
        .fn()
        .mockResolvedValue(params?.allAccounts ?? []),
    } as unknown as AccountService;
    const service = new TransactionSynchronizeService({
      networkService,
      transactionRepository,
      transactionMapper,
      accountService,
      logger,
    });

    return {
      service,
      networkService,
      transactionRepository,
      accountService,
      getTransactionsSpy: jest.spyOn(networkService, 'getTransactions'),
      getTransactionSpy: jest.spyOn(networkService, 'getTransaction'),
      findByAccountIdsSpy: jest.spyOn(
        transactionRepository,
        'findByAccountIds',
      ),
      findLastScanTokenSpy: jest.spyOn(
        transactionRepository,
        'findLastScanTokenByAccountIds',
      ),
      saveManySpy: jest.spyOn(transactionRepository, 'saveMany'),
      emitSnapKeyringEventSpy: jest.mocked(emitSnapKeyringEvent),
    };
  };

  const buildActivatedPair = (accountId: string, address: string) => {
    const keyringAccount = generateStellarKeyringAccount(
      accountId,
      address,
      'sync-entropy',
      0,
    );
    const onChainAccount = new OnChainAccount(
      createMockAccountWithBalances(address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 100,
      }),
      scope,
      horizonSource(
        createMockAccountWithBalances(address, '1', {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 100,
        }),
        scope,
      ),
    );

    return {
      keyringAccount,
      onChainAccount,
      activatedAccountPair: {
        keyringAccount,
        onChainAccount,
      } satisfies ActivatedAccountPair,
    };
  };

  it('returns early without network calls when accounts are empty', async () => {
    const {
      service,
      getTransactionsSpy,
      saveManySpy,
      emitSnapKeyringEventSpy,
    } = setup();

    await service.synchronize([], scope, []);

    expect(getTransactionsSpy).not.toHaveBeenCalled();
    expect(saveManySpy).not.toHaveBeenCalled();
    expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
  });

  it('scans on-chain history, emits updates, and persists mapped transactions', async () => {
    const {
      service,
      getTransactionsSpy,
      findByAccountIdsSpy,
      findLastScanTokenSpy,
      saveManySpy,
      emitSnapKeyringEventSpy,
    } = setup();
    const { keyringAccount, activatedAccountPair } = buildActivatedPair(
      'account-sync-1',
      'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO',
    );
    const onChainTransaction = buildOnChainPaymentTransaction({
      sourceAddress: keyringAccount.address,
      destinationAddress,
      amount: '3',
    });

    findByAccountIdsSpy.mockResolvedValue([]);
    findLastScanTokenSpy.mockResolvedValue({
      [keyringAccount.id]: null,
    });
    getTransactionsSpy.mockResolvedValue([onChainTransaction]);

    await service.synchronize([activatedAccountPair], scope, []);

    expect(getTransactionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountAddress: keyringAccount.address,
        lastScanToken: null,
        scope,
        order: 'desc',
      }),
    );
    expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
      getSnapProvider(),
      KeyringEvent.AccountTransactionsUpdated,
      {
        transactions: {
          [keyringAccount.id]: [
            expect.objectContaining({
              id: onChainTransaction.id,
              account: keyringAccount.id,
              status: TransactionStatus.Confirmed,
            }),
          ],
        },
      },
    );
    expect(saveManySpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: onChainTransaction.id,
          account: keyringAccount.id,
        }),
      ],
      {
        [keyringAccount.id]: {
          [scope]: 'scan-token-1',
        },
      },
    );
  });

  it('reconciles pending transactions from snap state by transaction hash', async () => {
    const {
      service,
      getTransactionsSpy,
      getTransactionSpy,
      findByAccountIdsSpy,
      findLastScanTokenSpy,
      saveManySpy,
    } = setup();
    const { keyringAccount, activatedAccountPair } = buildActivatedPair(
      'account-sync-2',
      'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO',
    );
    const onChainTransaction = buildOnChainPaymentTransaction({
      sourceAddress: keyringAccount.address,
      destinationAddress,
      amount: '5',
    });
    const [pendingTransaction] = generateMockTransactions(1, {
      id: onChainTransaction.id,
      account: keyringAccount.id,
      scope,
      status: TransactionStatus.Unconfirmed,
    });

    findByAccountIdsSpy.mockResolvedValue([
      pendingTransaction as KeyringTransaction,
    ]);
    findLastScanTokenSpy.mockResolvedValue({
      [keyringAccount.id]: 'existing-token',
    });
    getTransactionsSpy.mockResolvedValue([]);
    getTransactionSpy.mockResolvedValue(onChainTransaction);

    await service.synchronize([activatedAccountPair], scope, []);

    expect(getTransactionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        lastScanToken: 'existing-token',
        order: 'asc',
      }),
    );
    expect(getTransactionSpy).toHaveBeenCalledWith(
      onChainTransaction.id,
      scope,
    );
    expect(saveManySpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: onChainTransaction.id,
          account: keyringAccount.id,
          status: TransactionStatus.Confirmed,
        }),
      ],
      {
        [keyringAccount.id]: {
          [scope]: 'existing-token',
        },
      },
    );
  });

  it('maps SEP-41 receive for a snap-managed recipient when send is confirmed', async () => {
    const senderAccount = generateStellarKeyringAccount(
      'sender-account',
      sep41SenderAddress,
      'sync-entropy',
      0,
    );
    const recipientAccount = generateStellarKeyringAccount(
      'recipient-account',
      sep41RecipientAddress,
      'sync-entropy',
      1,
    );
    const {
      service,
      getTransactionsSpy,
      findByAccountIdsSpy,
      findLastScanTokenSpy,
      saveManySpy,
      emitSnapKeyringEventSpy,
    } = setup({
      allAccounts: [senderAccount, recipientAccount],
    });
    const { activatedAccountPair } = buildActivatedPair(
      senderAccount.id,
      senderAccount.address,
    );
    const onChainTransaction = Transaction.fromHorizon({
      horizonTransaction: sep41SendTransactionResponse,
      scope,
    });

    findByAccountIdsSpy.mockResolvedValue([]);
    findLastScanTokenSpy.mockResolvedValue({
      [senderAccount.id]: null,
    });
    getTransactionsSpy.mockResolvedValue([onChainTransaction]);

    await service.synchronize([activatedAccountPair], scope, [
      sep41AssetMetadata,
    ]);

    expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
      getSnapProvider(),
      KeyringEvent.AccountTransactionsUpdated,
      {
        transactions: {
          [senderAccount.id]: [
            expect.objectContaining({
              id: onChainTransaction.id,
              account: senderAccount.id,
              type: TransactionType.Send,
            }),
          ],
          [recipientAccount.id]: [
            expect.objectContaining({
              id: onChainTransaction.id,
              account: recipientAccount.id,
              type: TransactionType.Receive,
              from: [
                expect.objectContaining({
                  address: sep41SenderAddress,
                }),
              ],
              to: [
                expect.objectContaining({
                  address: sep41RecipientAddress,
                }),
              ],
            }),
          ],
        },
      },
    );
    expect(saveManySpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: onChainTransaction.id,
          account: senderAccount.id,
          type: TransactionType.Send,
        }),
        expect.objectContaining({
          id: onChainTransaction.id,
          account: recipientAccount.id,
          type: TransactionType.Receive,
        }),
      ]),
      {
        [senderAccount.id]: {
          [scope]: sep41SendTransactionResponse.paging_token,
        },
      },
    );
  });

  it('skips SEP-41 receive mapping when send is not confirmed', async () => {
    const senderAccount = generateStellarKeyringAccount(
      'sender-account-pending',
      sep41SenderAddress,
      'sync-entropy',
      0,
    );
    const recipientAccount = generateStellarKeyringAccount(
      'recipient-account-pending',
      sep41RecipientAddress,
      'sync-entropy',
      1,
    );
    const {
      service,
      getTransactionsSpy,
      findByAccountIdsSpy,
      findLastScanTokenSpy,
      emitSnapKeyringEventSpy,
    } = setup({
      allAccounts: [senderAccount, recipientAccount],
    });
    const { activatedAccountPair } = buildActivatedPair(
      senderAccount.id,
      senderAccount.address,
    );
    const onChainTransaction = Transaction.fromHorizon({
      horizonTransaction: {
        ...sep41SendTransactionResponse,
        successful: false,
      },
      scope,
    });

    findByAccountIdsSpy.mockResolvedValue([]);
    findLastScanTokenSpy.mockResolvedValue({
      [senderAccount.id]: null,
    });
    getTransactionsSpy.mockResolvedValue([onChainTransaction]);

    await service.synchronize([activatedAccountPair], scope, [
      sep41AssetMetadata,
    ]);

    expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
      getSnapProvider(),
      KeyringEvent.AccountTransactionsUpdated,
      {
        transactions: {
          [senderAccount.id]: [
            expect.objectContaining({
              id: onChainTransaction.id,
              account: senderAccount.id,
              status: TransactionStatus.Failed,
            }),
          ],
        },
      },
    );
    expect(emitSnapKeyringEventSpy.mock.calls[0]?.[2]).not.toHaveProperty(
      `transactions.${recipientAccount.id}`,
    );
  });
});
