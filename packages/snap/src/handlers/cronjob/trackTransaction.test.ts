import {
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

import {
  BackgroundEventMethod,
  TrackTransactionOnChainReconciliation,
} from './api';
import { TrackTransactionHandler } from './trackTransaction';
import * as trackTransactionReconciliation from './trackTransactionReconciliation';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { InMemoryCache } from '../../services/cache';
import { NetworkService } from '../../services/network';
import { TransactionPollException } from '../../services/network/exceptions';
import { OnChainAccountService } from '../../services/on-chain-account';
import type { OnChainAccountRepository } from '../../services/on-chain-account/OnChainAccountRepository';
import { TransactionService } from '../../services/transaction';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { logger, noOpLogger } from '../../utils/logger';
import { scheduleBackgroundEvent } from '../../utils/snap';

const { reconcileAfterRpcSuccess: actualReconcileAfterRpcSuccess } =
  jest.requireActual('./trackTransactionReconciliation');

jest.mock('../../utils/logger');
jest.mock('../../utils/snap', () => {
  const actual = jest.requireActual('../../utils/snap');
  return {
    ...actual,
    scheduleBackgroundEvent: jest.fn().mockResolvedValue('scheduled'),
    getClientStatus: jest
      .fn()
      .mockResolvedValue({ active: true, locked: false }),
  };
});

describe('TrackTransactionHandler', () => {
  const txId = 'abc123';
  const scope = KnownCaip2ChainId.Testnet;
  const accountId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.mocked(scheduleBackgroundEvent).mockClear();
    jest.mocked(scheduleBackgroundEvent).mockResolvedValue('scheduled');
    jest
      .spyOn(trackTransactionReconciliation, 'reconcileAfterRpcSuccess')
      .mockImplementation(async (params) =>
        actualReconcileAfterRpcSuccess({
          ...params,
          delayFn: jest.fn().mockResolvedValue(undefined),
        }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  function setup(options?: { initialSequence?: string }) {
    const account = generateStellarKeyringAccount(
      accountId,
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      'entropy-source-1',
      0,
    );

    let persistedSequence = options?.initialSequence ?? '100';

    const findByIds = jest
      .spyOn(AccountService.prototype, 'findByIds')
      .mockResolvedValue([account]);

    const findById = jest
      .spyOn(AccountService.prototype, 'findById')
      .mockResolvedValue(account);

    const pollTransaction = jest.spyOn(
      NetworkService.prototype,
      'pollTransaction',
    );

    const findKeyringTransactionByTransactionId = jest.spyOn(
      TransactionService.prototype,
      'findKeyringTransactionByTransactionId',
    );

    const synchronize = jest
      .spyOn(OnChainAccountService.prototype, 'synchronize')
      .mockResolvedValue(undefined);

    const updateKeyringTransactionStatus = jest
      .spyOn(TransactionService.prototype, 'updateKeyringTransactionStatus')
      .mockResolvedValue(undefined);

    const findByKeyringAccountId = jest.fn(async () => ({
      accountId: account.address,
      sequenceNumber: persistedSequence,
      scope,
    }));

    const onChainAccountRepository = {
      findByKeyringAccountId,
    } as unknown as OnChainAccountRepository;

    const { transactionService } = createMockTransactionService();

    findKeyringTransactionByTransactionId.mockResolvedValue(undefined);

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
      onChainAccountRepository,
      accountService: new AccountService({
        logger,
        accountsRepository: {} as never,
        walletService: {} as never,
      }),
      transactionService,
    });

    const setPersistedSequence = (sequence: string): void => {
      persistedSequence = sequence;
    };

    return {
      handler,
      account,
      findByIds,
      findById,
      pollTransaction,
      findKeyringTransactionByTransactionId,
      synchronize,
      updateKeyringTransactionStatus,
      findByKeyringAccountId,
      setPersistedSequence,
    };
  }

  it('loads persisted keyring transaction from state before Soroban poll', async () => {
    const { handler, pollTransaction, findKeyringTransactionByTransactionId } =
      setup();
    const callOrder: string[] = [];
    findKeyringTransactionByTransactionId.mockImplementation(async () => {
      callOrder.push('findPersisted');
      return undefined;
    });
    pollTransaction.mockImplementation(async () => {
      callOrder.push('poll');
      return txId;
    });

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(callOrder).toStrictEqual(['findPersisted', 'poll']);
  });

  it('settles keyring row as confirmed after sync when RPC poll succeeds', async () => {
    const {
      handler,
      account,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockResolvedValue(txId);

    const callOrder: string[] = [];
    synchronize.mockImplementation(async () => {
      callOrder.push('sync');
    });
    updateKeyringTransactionStatus.mockImplementation(async () => {
      callOrder.push('settle');
    });

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(pollTransaction).toHaveBeenCalledWith(txId, scope);
    expect(callOrder).toStrictEqual(['sync', 'settle']);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('retries sync until sequence advances for WaitForAccountSequence reconciliation', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
      findByKeyringAccountId,
    } = setup({ initialSequence: '100' });
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockResolvedValue(txId);

    const sequenceReads = ['100', '100', '101'] as const;
    let readCall = 0;
    findByKeyringAccountId.mockImplementation(async () => {
      const sequenceNumber = sequenceReads[readCall] as string;
      readCall += 1;
      return {
        accountId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        sequenceNumber,
        scope,
      };
    });

    const callOrder: string[] = [];
    synchronize.mockImplementation(async () => {
      callOrder.push('sync');
    });
    updateKeyringTransactionStatus.mockImplementation(async () => {
      callOrder.push('settle');
    });

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        onChainReconciliation:
          TrackTransactionOnChainReconciliation.WaitForAccountSequence,
      },
    });

    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(callOrder).toStrictEqual(['sync', 'sync', 'settle']);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
  });

  it('settles confirmed after exhausting WaitForAccountSequence retries', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup({ initialSequence: '100' });
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockResolvedValue(txId);

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        onChainReconciliation:
          TrackTransactionOnChainReconciliation.WaitForAccountSequence,
      },
    });

    expect(synchronize).toHaveBeenCalledTimes(6);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
  });

  it('settles keyring row as failed for non-unknown poll status', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockRejectedValue(
      new TransactionPollException(txId, 'failed', scope),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Failed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('leaves pending when poll status is unknown and still synchronizes', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockRejectedValue(
      new TransactionPollException(txId, 'unknown', scope),
    );

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(updateKeyringTransactionStatus).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('leaves pending on unexpected poll error and still synchronizes', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    pollTransaction.mockRejectedValue(new Error('unexpected poll failure'));

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(updateKeyringTransactionStatus).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledTimes(1);
  });

  it('syncs from persisted keyring transaction account without findByIds', async () => {
    const {
      handler,
      account,
      findByIds,
      findById,
      pollTransaction,
      findKeyringTransactionByTransactionId,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
    const persisted = createPersistedKeyringTransaction();
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    findByIds.mockResolvedValue([]);
    findById.mockResolvedValue(account);
    pollTransaction.mockResolvedValue(txId);

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(findById).toHaveBeenCalledWith(accountId);
    expect(findByIds).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
  });

  it('does not synchronize when persisted tx references missing keyring account', async () => {
    const {
      handler,
      findByIds,
      findById,
      pollTransaction,
      findKeyringTransactionByTransactionId,
      synchronize,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction('deadbeef-dead-4ead-8ead-deadbeefdead'),
    );
    findById.mockResolvedValue(undefined);
    pollTransaction.mockResolvedValue(txId);

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(findByIds).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  });

  it('skips sync when no persisted row exists', async () => {
    const { handler, pollTransaction, synchronize } = setup();
    pollTransaction.mockResolvedValue(txId);

    await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(pollTransaction).toHaveBeenCalledWith(txId, scope);
    expect(synchronize).not.toHaveBeenCalled();
  });
});
