import { TransactionStatus } from '@metamask/keyring-api';

import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { generateMockTransactions } from './__mocks__/transaction.fixtures';
import type { StellarKeyringTransaction } from './api';
import type { TransactionStateValue } from './TransactionRepository';
import { TransactionRepository } from './TransactionRepository';
import { getSnapProvider } from '../../utils/snap';
import { State } from '../state/State';

jest.mock('../../utils/snap');

describe('TransactionRepository', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const accountId = 'account-1';

  const defaultState: TransactionStateValue = {
    transactions: {},
    lastScanTokens: {},
  };

  const recentTimestampSeconds = () => Math.floor(Date.now() / 1000);

  const expiredTimestampSeconds = () =>
    Math.floor(
      (Date.now() - AppConfig.transaction.maxPendingTransactionAge - 1000) /
        1000,
    );

  let mockState: TransactionStateValue;

  const createRepository = () =>
    new TransactionRepository(
      new State({
        encrypted: false,
        defaultState,
      }),
    );

  beforeEach(() => {
    mockState = structuredClone(defaultState);
    const snapProvider = getSnapProvider() as { request: jest.Mock };
    snapProvider.request.mockImplementation(async ({ method, params }) => {
      if (method === 'snap_getState') {
        if (params.key) {
          return mockState[params.key as keyof TransactionStateValue];
        }
        return mockState;
      }

      if (method === 'snap_manageState' && params.operation === 'update') {
        mockState = params.newState as TransactionStateValue;
      }

      return null;
    });
  });

  afterEach(() => {
    (getSnapProvider() as { request: jest.Mock }).request.mockReset();
  });

  it('removes confirmed incoming transactions from snap state', async () => {
    const repository = createRepository();
    const pendingTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Unconfirmed,
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([pendingTransaction]);

    const confirmedTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Confirmed,
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([confirmedTransaction]);

    const stored = await repository.findStellarTransactionsByAccountIds([
      accountId,
    ]);
    expect(stored).toStrictEqual([]);
  });

  it('keeps incoming pending over existing when reconcileAttemptCount is higher', async () => {
    const repository = createRepository();
    const pendingTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: 100,
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([
      {
        ...pendingTransaction,
        reconcileAttemptCount: 1,
      } as StellarKeyringTransaction,
    ]);

    await repository.saveMany([
      {
        ...pendingTransaction,
        reconcileAttemptCount: 2,
      } as StellarKeyringTransaction,
    ]);

    const stored = await repository.findStellarTransactionsByAccountIds([
      accountId,
    ]);
    expect(stored).toStrictEqual([
      expect.objectContaining({
        id: 'tx-hash-1',
        reconcileAttemptCount: 2,
      }),
    ]);
  });

  it('drops pending transactions when reconcile attempts and max age are both exceeded', async () => {
    const repository = createRepository();
    const pendingTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: expiredTimestampSeconds(),
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([
      {
        ...pendingTransaction,
        reconcileAttemptCount: 5,
      } as StellarKeyringTransaction,
    ]);

    const stored = await repository.findStellarTransactionsByAccountIds([
      accountId,
    ]);
    expect(stored).toStrictEqual([]);
  });

  it('keeps pending transactions when reconcile attempts exceeded but max age is not', async () => {
    const repository = createRepository();
    const pendingTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: recentTimestampSeconds(),
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([
      {
        ...pendingTransaction,
        reconcileAttemptCount: 5,
      } as StellarKeyringTransaction,
    ]);

    const stored = await repository.findStellarTransactionsByAccountIds([
      accountId,
    ]);
    expect(stored).toStrictEqual([
      expect.objectContaining({
        id: 'tx-hash-1',
        reconcileAttemptCount: 5,
      }),
    ]);
  });

  it('keeps pending transactions when max age exceeded but reconcile attempts are not', async () => {
    const repository = createRepository();
    const pendingTransaction = generateMockTransactions(1, {
      id: 'tx-hash-1',
      account: accountId,
      scope,
      status: TransactionStatus.Unconfirmed,
      timestamp: expiredTimestampSeconds(),
    })[0] as StellarKeyringTransaction;

    await repository.saveMany([
      {
        ...pendingTransaction,
        reconcileAttemptCount: 1,
      } as StellarKeyringTransaction,
    ]);

    const stored = await repository.findStellarTransactionsByAccountIds([
      accountId,
    ]);
    expect(stored).toStrictEqual([
      expect.objectContaining({
        id: 'tx-hash-1',
        reconcileAttemptCount: 1,
      }),
    ]);
  });
});
