import { TransactionStatus } from '@metamask/keyring-api';

import { BackgroundEventMethod } from './api';
import { TrackTransactionHandler } from './trackTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { NetworkService } from '../../services/network';
import { OnChainAccountService } from '../../services/on-chain-account';
import { TransactionService } from '../../services/transaction';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { logger } from '../../utils/logger';
import { scheduleBackgroundEvent } from '../../utils/snap';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap', () => ({
  scheduleBackgroundEvent: jest.fn().mockResolvedValue('scheduled'),
  getClientStatus: jest.fn().mockResolvedValue({ active: true, locked: false }),
}));

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

    const getHorizonTransactionInclusionStatus = jest.spyOn(
      NetworkService.prototype,
      'getHorizonTransactionInclusionStatus',
    );

    const synchronize = jest
      .spyOn(OnChainAccountService.prototype, 'synchronize')
      .mockResolvedValue(undefined);

    const applyKeyringTransactionSettlement = jest
      .spyOn(TransactionService.prototype, 'applyKeyringTransactionSettlement')
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
      getHorizonTransactionInclusionStatus,
      synchronize,
      applyKeyringTransactionSettlement,
    };
  }

  it('reschedules when Horizon reports pending', async () => {
    const { handler, getHorizonTransactionInclusionStatus, synchronize } =
      setup();
    getHorizonTransactionInclusionStatus.mockResolvedValue('pending');

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 0,
      },
    });

    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 1,
      },
      duration: TrackTransactionHandler.duration,
    });
  });

  it('synchronizes when Horizon reports success', async () => {
    const {
      handler,
      account,
      getHorizonTransactionInclusionStatus,
      synchronize,
      applyKeyringTransactionSettlement,
    } = setup();
    getHorizonTransactionInclusionStatus.mockResolvedValue('success');

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(applyKeyringTransactionSettlement).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith([account], scope);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('synchronizes when Horizon reports failed', async () => {
    const {
      handler,
      getHorizonTransactionInclusionStatus,
      synchronize,
      applyKeyringTransactionSettlement,
    } = setup();
    getHorizonTransactionInclusionStatus.mockResolvedValue('failed');

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(applyKeyringTransactionSettlement).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Failed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('synchronizes on max attempts without reschedule', async () => {
    const {
      handler,
      getHorizonTransactionInclusionStatus,
      synchronize,
      applyKeyringTransactionSettlement,
    } = setup();
    getHorizonTransactionInclusionStatus.mockResolvedValue('pending');

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 15,
      },
    });

    expect(getHorizonTransactionInclusionStatus).toHaveBeenCalledTimes(1);
    expect(applyKeyringTransactionSettlement).not.toHaveBeenCalled();
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('settles keyring row on max attempts when final Horizon poll succeeds', async () => {
    const {
      handler,
      getHorizonTransactionInclusionStatus,
      synchronize,
      applyKeyringTransactionSettlement,
    } = setup();
    getHorizonTransactionInclusionStatus.mockResolvedValue('success');

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 15,
      },
    });

    expect(applyKeyringTransactionSettlement).toHaveBeenCalledWith({
      txId,
      accountIds: [accountId],
      status: TransactionStatus.Confirmed,
    });
    expect(synchronize).toHaveBeenCalledTimes(1);
  });

  it('returns early when no accounts match', async () => {
    const {
      handler,
      findByIds,
      getHorizonTransactionInclusionStatus,
      synchronize,
    } = setup();
    findByIds.mockResolvedValue([]);

    await handler.handleCronJobRequest({
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
      },
    });

    expect(getHorizonTransactionInclusionStatus).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });
});
