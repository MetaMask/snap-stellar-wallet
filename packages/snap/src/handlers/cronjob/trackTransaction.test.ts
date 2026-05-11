import {
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

import { BackgroundEventMethod } from './api';
import { TrackTransactionHandler } from './trackTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { NetworkService } from '../../services/network';
import { TransactionPollException } from '../../services/network/exceptions';
import { OnChainAccountService } from '../../services/on-chain-account';
import { TransactionService } from '../../services/transaction';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { logger } from '../../utils/logger';
import { scheduleBackgroundEvent } from '../../utils/snap';

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
  });

  function setup() {
    const account = generateStellarKeyringAccount(
      accountId,
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      'entropy-source-1',
      0,
    );

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

    const { transactionService } = createMockTransactionService();

    findKeyringTransactionByTransactionId.mockResolvedValue(undefined);

    const handler = new TrackTransactionHandler({
      logger,
      networkService: new NetworkService({ logger }),
      onChainAccountService: new OnChainAccountService({
        logger,
        networkService: new NetworkService({ logger }),
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
      findByIds,
      findById,
      pollTransaction,
      findKeyringTransactionByTransactionId,
      synchronize,
      updateKeyringTransactionStatus,
    };
  }

  it('loads persisted keyring transaction from state before Soroban poll', async () => {
    const {
      handler,
      account,
      findByIds,
      pollTransaction,
      findKeyringTransactionByTransactionId,
    } = setup();
    const callOrder: string[] = [];
    findKeyringTransactionByTransactionId.mockImplementation(async () => {
      callOrder.push('findPersisted');
      return undefined;
    });
    pollTransaction.mockImplementation(async () => {
      callOrder.push('poll');
      return txId;
    });
    findByIds.mockImplementation(async () => {
      callOrder.push('findByIds');
      return [account];
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

    expect(callOrder).toStrictEqual(['findPersisted', 'poll', 'findByIds']);
  });

  it('settles keyring row as confirmed when RPC poll succeeds', async () => {
    const {
      handler,
      account,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
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
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('settles keyring row as failed for non-unknown poll status', async () => {
    const {
      handler,
      pollTransaction,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
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
    } = setup();
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
    } = setup();
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
    const persisted: KeyringTransaction = {
      type: TransactionType.Send,
      id: txId,
      account: accountId,
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: 1,
      from: [],
      to: [],
      events: [],
      fees: [],
    };
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

  it('falls back to findByIds when persisted tx references missing account', async () => {
    const {
      handler,
      account,
      findByIds,
      findById,
      pollTransaction,
      findKeyringTransactionByTransactionId,
      synchronize,
    } = setup();
    const persisted: KeyringTransaction = {
      type: TransactionType.Send,
      id: txId,
      account: 'deadbeef-dead-4ead-8ead-deadbeefdead',
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: 1,
      from: [],
      to: [],
      events: [],
      fees: [],
    };
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    findById.mockResolvedValue(undefined);
    findByIds.mockResolvedValue([account]);
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

    expect(findByIds).toHaveBeenCalledWith([accountId]);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
  });

  it('skips sync when no persisted row and findByIds returns empty', async () => {
    const { handler, findByIds, pollTransaction, synchronize } = setup();
    findByIds.mockResolvedValue([]);
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
