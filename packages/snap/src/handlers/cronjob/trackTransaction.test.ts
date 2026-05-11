import { TransactionStatus } from '@metamask/keyring-api';

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

    const pollTransaction = jest.spyOn(
      NetworkService.prototype,
      'pollTransaction',
    );

    const fetchHorizonTransactionSourceAccount = jest.spyOn(
      NetworkService.prototype,
      'fetchHorizonTransactionSourceAccount',
    );

    const synchronize = jest
      .spyOn(OnChainAccountService.prototype, 'synchronize')
      .mockResolvedValue(undefined);

    const updateKeyringTransactionStatus = jest
      .spyOn(TransactionService.prototype, 'updateKeyringTransactionStatus')
      .mockResolvedValue(undefined);

    const { transactionService } = createMockTransactionService();

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
      pollTransaction,
      fetchHorizonTransactionSourceAccount,
      synchronize,
      updateKeyringTransactionStatus,
    };
  }

  it('polls the transaction before loading keyring accounts by id', async () => {
    const { handler, account, findByIds, pollTransaction } = setup();
    const callOrder: string[] = [];
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

    expect(callOrder).toStrictEqual(['poll', 'findByIds']);
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

  it('polls when findByIds returns empty and skips sync if Horizon has no transaction yet', async () => {
    const {
      handler,
      findByIds,
      pollTransaction,
      fetchHorizonTransactionSourceAccount,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
    findByIds.mockResolvedValue([]);
    pollTransaction.mockResolvedValue(txId);
    fetchHorizonTransactionSourceAccount.mockResolvedValue(null);

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
    expect(fetchHorizonTransactionSourceAccount).toHaveBeenCalledWith(
      txId,
      scope,
    );
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
    expect(synchronize).not.toHaveBeenCalled();
  });

  it('resolves sync target from Horizon transaction source when findByIds returns empty', async () => {
    const {
      handler,
      account,
      findByIds,
      pollTransaction,
      fetchHorizonTransactionSourceAccount,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
    const source = account.address;
    findByIds.mockResolvedValue([]);
    pollTransaction.mockResolvedValue(txId);
    fetchHorizonTransactionSourceAccount.mockResolvedValue(source);
    const resolveAccount = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });

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

    expect(resolveAccount).toHaveBeenCalledWith({
      accountAddress: source,
      scope,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });

    resolveAccount.mockRestore();
  });
});
