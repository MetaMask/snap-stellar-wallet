import {
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

import { BackgroundEventMethod } from './api';
import { TrackTransactionHandler } from './trackTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { KEYRING_ACCOUNT_TYPE, METAMASK_ORIGIN } from '../../constants';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { InMemoryCache } from '../../services/cache';
import {
  NetworkService,
  NetworkServiceException,
  TransactionNotFoundException,
} from '../../services/network';
import { OnChainAccountService } from '../../services/on-chain-account';
import { TransactionService } from '../../services/transaction';
import {
  buildMockClassicTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { Transaction } from '../../services/transaction/Transaction';
import { logger, noOpLogger } from '../../utils/logger';
import {
  Duration,
  scheduleBackgroundEvent,
  trackTransactionFinalized,
} from '../../utils/snap';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap', () => {
  const actual = jest.requireActual('../../utils/snap');
  return {
    ...actual,
    scheduleBackgroundEvent: jest.fn().mockResolvedValue('scheduled'),
    trackTransactionFinalized: jest.fn().mockResolvedValue(undefined),
    getClientStatus: jest
      .fn()
      .mockResolvedValue({ active: true, locked: false }),
  };
});

describe('TrackTransactionHandler', () => {
  const txId =
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1';
  const scope = KnownCaip2ChainId.Testnet;
  const accountId = '22222222-2222-4222-8222-222222222222';
  const receiverAddress =
    'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';

  beforeEach(() => {
    jest.mocked(scheduleBackgroundEvent).mockClear();
    jest.mocked(scheduleBackgroundEvent).mockResolvedValue('scheduled');
    jest.mocked(trackTransactionFinalized).mockClear();
    jest.mocked(trackTransactionFinalized).mockResolvedValue(undefined);
  });

  function createPersistedKeyringTransaction(
    account: string = accountId,
  ): KeyringTransaction {
    return {
      type: TransactionType.Send,
      id: txId,
      account,
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: 1,
      from: [],
      to: [],
      events: [],
      fees: [],
    };
  }

  function createNetworkTransaction(status: TransactionStatus): Transaction {
    const built = buildMockClassicTransaction([
      {
        type: 'payment',
        params: {
          destination: receiverAddress,
          asset: 'native',
          amount: '1',
        },
      },
    ]);
    return new Transaction(built.getRaw(), { status });
  }

  function setup() {
    const account = generateStellarKeyringAccount(
      accountId,
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      'entropy-source-1',
      0,
    );
    const receiverAccount = generateStellarKeyringAccount(
      '33333333-3333-4333-8333-333333333333',
      receiverAddress,
      'entropy-source-2',
      1,
    );

    const findById = jest
      .spyOn(AccountService.prototype, 'findById')
      .mockResolvedValue(account);

    const findByAddressAndScope = jest
      .spyOn(AccountService.prototype, 'findByAddressAndScope')
      .mockResolvedValue(null);

    const getTransaction = jest.spyOn(
      NetworkService.prototype,
      'getTransaction',
    );

    const findKeyringTransactionByTransactionId = jest.spyOn(
      TransactionService.prototype,
      'findKeyringTransactionByTransactionId',
    );

    const save = jest
      .spyOn(TransactionService.prototype, 'save')
      .mockResolvedValue(undefined);

    const synchronize = jest
      .spyOn(OnChainAccountService.prototype, 'synchronize')
      .mockResolvedValue(undefined);

    const { transactionService } = createMockTransactionService();

    findKeyringTransactionByTransactionId.mockResolvedValue(null);

    const networkCache = new InMemoryCache(noOpLogger);

    const handler = new TrackTransactionHandler({
      logger,
      networkService: new NetworkService({ logger, cache: networkCache }),
      onChainAccountService: new OnChainAccountService({
        logger,
        networkService: new NetworkService({ logger, cache: networkCache }),
        onChainAccountRepository: {} as never,
        assetMetadataService: {} as never,
      }),
      accountService: new AccountService({
        logger,
        accountsRepository: {} as never,
        walletService: {} as never,
      }),
      transactionService,
    });

    return {
      handler,
      account,
      receiverAccount,
      findById,
      findByAddressAndScope,
      getTransaction,
      findKeyringTransactionByTransactionId,
      save,
      synchronize,
    };
  }

  it('fetches transaction from network before synchronizing', async () => {
    const { handler, getTransaction } = setup();
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(getTransaction).toHaveBeenCalledWith(txId, scope);
  });

  it('updates keyring status then syncs when transaction is confirmed', async () => {
    const {
      handler,
      account,
      getTransaction,
      save,
      synchronize,
      findKeyringTransactionByTransactionId,
    } = setup();
    const persisted = createPersistedKeyringTransaction();
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    const callOrder: string[] = [];
    save.mockImplementation(async () => {
      callOrder.push('save');
    });
    synchronize.mockImplementation(async () => {
      callOrder.push('sync');
    });

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(callOrder).toStrictEqual(['save', 'sync']);
    expect(save).toHaveBeenCalledWith({
      ...persisted,
      status: TransactionStatus.Confirmed,
      events: [
        ...persisted.events,
        {
          status: TransactionStatus.Confirmed,
          timestamp: expect.any(Number),
        },
      ],
    });
    expect(trackTransactionFinalized).toHaveBeenCalledWith({
      origin: METAMASK_ORIGIN,
      accountType: KEYRING_ACCOUNT_TYPE,
      chainIdCaip: scope,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('reschedules when transaction is not found on first attempt', async () => {
    const { handler, getTransaction, save, synchronize } = setup();
    getTransaction.mockRejectedValue(new TransactionNotFoundException(txId));

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(save).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
        attempt: 1,
      },
      duration: Duration.TwoSeconds,
    });
  });

  it('settles confirmed after reschedule then confirmed across cron runs', async () => {
    const {
      handler,
      getTransaction,
      save,
      synchronize,
      findKeyringTransactionByTransactionId,
    } = setup();
    const persisted = createPersistedKeyringTransaction();
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    getTransaction
      .mockRejectedValueOnce(new TransactionNotFoundException(txId))
      .mockResolvedValueOnce(
        createNetworkTransaction(TransactionStatus.Confirmed),
      );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(getTransaction).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(1);

    await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
        attempt: 1,
      },
    });

    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: txId,
        status: TransactionStatus.Confirmed,
      }),
    );
  });

  it('stops rescheduling after max attempts when transaction is still not found', async () => {
    const { handler, getTransaction, save, synchronize } = setup();
    getTransaction.mockRejectedValue(new TransactionNotFoundException(txId));

    for (
      let attempt = 0;
      attempt <= AppConfig.transaction.trackTransactionMaxReschedules;
      attempt += 1
    ) {
      await handler.handle({
        jsonrpc: '2.0',
        id: attempt + 1,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId,
          scope,
          accountIdsOrAddresses: [accountId],
          attempt,
        },
      });
    }

    expect(getTransaction).toHaveBeenCalledTimes(
      AppConfig.transaction.trackTransactionMaxReschedules + 1,
    );
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(
      AppConfig.transaction.trackTransactionMaxReschedules,
    );
    expect(save).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  });

  it('updates keyring status to failed and syncs when transaction failed', async () => {
    const {
      handler,
      getTransaction,
      save,
      synchronize,
      findKeyringTransactionByTransactionId,
    } = setup();
    const persisted = createPersistedKeyringTransaction();
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Failed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: txId,
        status: TransactionStatus.Failed,
      }),
    );
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('skips synchronization when transaction status is not terminal', async () => {
    const { handler, getTransaction, save, synchronize } = setup();
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Submitted),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(save).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('reschedules when network service throws NetworkServiceException', async () => {
    const { handler, getTransaction, save, synchronize } = setup();
    getTransaction.mockRejectedValue(
      new NetworkServiceException('Failed to fetch transaction'),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(save).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(1);
  });

  it('syncs sender from accountIdsOrAddresses via findById', async () => {
    const { handler, account, findById, getTransaction, synchronize } = setup();
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(findById).toHaveBeenCalledWith(accountId);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
  });

  it('does not synchronize when sender account is not found', async () => {
    const { handler, findById, getTransaction, synchronize } = setup();
    findById.mockResolvedValue(undefined);
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(synchronize).not.toHaveBeenCalled();
  });

  it('includes receiver account in sync when address is provided and found', async () => {
    const {
      handler,
      account,
      receiverAccount,
      findByAddressAndScope,
      getTransaction,
      synchronize,
    } = setup();
    findByAddressAndScope.mockResolvedValue(receiverAccount);
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId, receiverAddress],
      },
    });

    expect(findByAddressAndScope).toHaveBeenCalledWith(receiverAddress, scope);
    expect(synchronize).toHaveBeenCalledWith([account, receiverAccount], scope);
  });

  it('syncs only sender when receiver address is not in keyring', async () => {
    const {
      handler,
      account,
      findByAddressAndScope,
      getTransaction,
      synchronize,
    } = setup();
    findByAddressAndScope.mockResolvedValue(null);
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId, receiverAddress],
      },
    });

    expect(findByAddressAndScope).toHaveBeenCalledWith(receiverAddress, scope);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
  });

  it('continues synchronization when keyring transaction row is missing', async () => {
    const { handler, account, getTransaction, save, synchronize } = setup();
    getTransaction.mockResolvedValue(
      createNetworkTransaction(TransactionStatus.Confirmed),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIdsOrAddresses: [accountId],
      },
    });

    expect(save).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledWith([account], scope);
  });
});
