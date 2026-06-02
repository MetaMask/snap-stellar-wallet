import {
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

import { BackgroundEventMethod } from './api';
import { TrackTransactionHandler } from './trackTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { InMemoryCache } from '../../services/cache';
import { NetworkService } from '../../services/network';
import { OnChainAccountService } from '../../services/on-chain-account';
import { TransactionService } from '../../services/transaction';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { logger, noOpLogger } from '../../utils/logger';
import { Duration, scheduleBackgroundEvent } from '../../utils/snap';

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

    const checkHorizonTransactionForTrack = jest.spyOn(
      NetworkService.prototype,
      'checkHorizonTransactionForTrack',
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
      findByIds,
      findById,
      checkHorizonTransactionForTrack,
      findKeyringTransactionByTransactionId,
      synchronize,
      updateKeyringTransactionStatus,
    };
  }

  it('loads persisted keyring transaction from state before Horizon track check', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      findKeyringTransactionByTransactionId,
    } = setup();
    const callOrder: string[] = [];
    findKeyringTransactionByTransactionId.mockImplementation(async () => {
      callOrder.push('findPersisted');
      return undefined;
    });
    checkHorizonTransactionForTrack.mockImplementation(async () => {
      callOrder.push('horizon');
      return 'confirmed';
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

    expect(callOrder).toStrictEqual(['findPersisted', 'horizon']);
  });

  it('syncs before settling confirmed when Horizon track check confirms', async () => {
    const {
      handler,
      account,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack.mockResolvedValue('confirmed');

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

    expect(checkHorizonTransactionForTrack).toHaveBeenCalledWith(txId, scope);
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

  it('reschedules when Horizon track check returns pending on first attempt', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack.mockResolvedValue('pending');

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
    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 1,
      },
      duration: Duration.TwoSeconds,
    });
  });

  it('settles confirmed after reschedule then confirmed across cron runs', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('confirmed');

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

    expect(checkHorizonTransactionForTrack).toHaveBeenCalledTimes(1);
    expect(updateKeyringTransactionStatus).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(1);

    await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 1,
      },
    });

    expect(checkHorizonTransactionForTrack).toHaveBeenCalledTimes(2);
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(updateKeyringTransactionStatus).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
  });

  it('leaves pending when Horizon keeps returning pending after max reschedules', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack.mockResolvedValue('pending');

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
          accountIds: [accountId],
          attempt,
        },
      });
    }

    expect(checkHorizonTransactionForTrack).toHaveBeenCalledTimes(
      AppConfig.transaction.trackTransactionMaxReschedules + 1,
    );
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(
      AppConfig.transaction.trackTransactionMaxReschedules,
    );
    expect(updateKeyringTransactionStatus).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledTimes(1);
  });

  it('settles keyring row as failed when Horizon track check reports failed', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack.mockResolvedValue('failed');

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

  it('leaves pending on unavailable Horizon track check and still synchronizes', async () => {
    const {
      handler,
      checkHorizonTransactionForTrack,
      synchronize,
      updateKeyringTransactionStatus,
      findKeyringTransactionByTransactionId,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction(),
    );
    checkHorizonTransactionForTrack.mockResolvedValue('unavailable');

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

  it('syncs from persisted keyring transaction account without findByIds', async () => {
    const {
      handler,
      account,
      findByIds,
      findById,
      checkHorizonTransactionForTrack,
      findKeyringTransactionByTransactionId,
      synchronize,
      updateKeyringTransactionStatus,
    } = setup();
    const persisted = createPersistedKeyringTransaction();
    findKeyringTransactionByTransactionId.mockResolvedValue(persisted);
    findByIds.mockResolvedValue([]);
    findById.mockResolvedValue(account);
    checkHorizonTransactionForTrack.mockResolvedValue('confirmed');

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
      checkHorizonTransactionForTrack,
      findKeyringTransactionByTransactionId,
      synchronize,
    } = setup();
    findKeyringTransactionByTransactionId.mockResolvedValue(
      createPersistedKeyringTransaction('deadbeef-dead-4ead-8ead-deadbeefdead'),
    );
    findById.mockResolvedValue(undefined);
    checkHorizonTransactionForTrack.mockResolvedValue('confirmed');

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
    const { handler, checkHorizonTransactionForTrack, synchronize } = setup();
    checkHorizonTransactionForTrack.mockResolvedValue('confirmed');

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

    expect(checkHorizonTransactionForTrack).toHaveBeenCalledWith(txId, scope);
    expect(synchronize).not.toHaveBeenCalled();
  });
});
