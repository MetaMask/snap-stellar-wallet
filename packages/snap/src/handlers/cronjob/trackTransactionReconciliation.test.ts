import { TrackTransactionOnChainReconciliation } from './api';
import {
  delayMilliseconds,
  HORIZON_RECONCILIATION_DELAY_MS,
  HORIZON_RECONCILIATION_MAX_ATTEMPTS,
  isSequenceAdvanced,
  reconcileAfterRpcSuccess,
} from './trackTransactionReconciliation';
import { KnownCaip2ChainId } from '../../api';
import { noOpLogger } from '../../utils/logger';

describe('isSequenceAdvanced', () => {
  it('returns true when current sequence is greater than baseline', () => {
    expect(isSequenceAdvanced('100', '101')).toBe(true);
  });

  it('returns false when current sequence equals baseline', () => {
    expect(isSequenceAdvanced('100', '100')).toBe(false);
  });

  it('returns false for non-numeric sequences', () => {
    expect(isSequenceAdvanced('abc', '101')).toBe(false);
  });
});

describe('reconcileAfterRpcSuccess', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;
  const context = {
    accountId,
    scope,
    baselineSequence: '100',
  };

  it('runs a single synchronize for None mode', async () => {
    const synchronize = jest.fn().mockResolvedValue(undefined);
    const readPersistedSequence = jest.fn();
    const delayFn = jest.fn().mockResolvedValue(undefined);

    await reconcileAfterRpcSuccess({
      mode: TrackTransactionOnChainReconciliation.None,
      context,
      synchronize,
      readPersistedSequence,
      logger: noOpLogger,
      delayFn,
    });

    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(readPersistedSequence).not.toHaveBeenCalled();
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('retries sync until persisted sequence advances for WaitForAccountSequence', async () => {
    const synchronize = jest.fn().mockResolvedValue(undefined);
    const readPersistedSequence = jest
      .fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('101');
    const delayFn = jest.fn().mockResolvedValue(undefined);

    await reconcileAfterRpcSuccess({
      mode: TrackTransactionOnChainReconciliation.WaitForAccountSequence,
      context,
      synchronize,
      readPersistedSequence,
      logger: noOpLogger,
      delayFn,
    });

    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(readPersistedSequence).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
    expect(delayFn).toHaveBeenCalledWith(HORIZON_RECONCILIATION_DELAY_MS);
  });

  it('stops after max attempts when sequence never advances', async () => {
    const synchronize = jest.fn().mockResolvedValue(undefined);
    const readPersistedSequence = jest.fn().mockResolvedValue('100');
    const delayFn = jest.fn().mockResolvedValue(undefined);

    await reconcileAfterRpcSuccess({
      mode: TrackTransactionOnChainReconciliation.WaitForAccountSequence,
      context,
      synchronize,
      readPersistedSequence,
      logger: noOpLogger,
      delayFn,
    });

    expect(synchronize).toHaveBeenCalledTimes(
      HORIZON_RECONCILIATION_MAX_ATTEMPTS,
    );
    expect(readPersistedSequence).toHaveBeenCalledTimes(
      HORIZON_RECONCILIATION_MAX_ATTEMPTS,
    );
    expect(delayFn).toHaveBeenCalledTimes(
      HORIZON_RECONCILIATION_MAX_ATTEMPTS - 1,
    );
  });
});

describe('delayMilliseconds', () => {
  it('resolves after the requested delay', async () => {
    jest.useFakeTimers();
    const promise = delayMilliseconds(1000);
    jest.advanceTimersByTime(1000);
    expect(await promise).toBeUndefined();
    jest.useRealTimers();
  });
});
