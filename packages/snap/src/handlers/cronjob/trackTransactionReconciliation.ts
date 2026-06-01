import { TrackTransactionOnChainReconciliation } from './api';
import type { KnownCaip2ChainId } from '../../api';
import type { ILogger } from '../../utils/logger';

/** Horizon polls after RPC success (Soroban can lead Horizon indexing). */
export const HORIZON_RECONCILIATION_MAX_ATTEMPTS = 6;

/** Delay between Horizon reconciliation sync attempts. */
export const HORIZON_RECONCILIATION_DELAY_MS = 2000;

export type ReconciliationContext = {
  accountId: string;
  scope: KnownCaip2ChainId;
  baselineSequence: string;
};

/**
 * Returns whether `current` is strictly greater than `baseline` Stellar sequence strings.
 *
 * @param baseline - Sequence before the tracked transaction.
 * @param current - Sequence after a sync attempt.
 * @returns True when Horizon has advanced the account sequence past the baseline.
 */
export function isSequenceAdvanced(baseline: string, current: string): boolean {
  try {
    return BigInt(current) > BigInt(baseline);
  } catch {
    return false;
  }
}

/**
 * Delays execution for background-event reconciliation retries.
 *
 * @param milliseconds - Delay duration in milliseconds.
 */
export async function delayMilliseconds(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Refreshes on-chain snap state after Soroban RPC SUCCESS, optionally waiting for Horizon
 * to index the account sequence before the caller settles the keyring transaction.
 *
 * @param params - Reconciliation inputs.
 * @param params.mode - Reconciliation strategy.
 * @param params.context - Account id, scope, and pre-sync baseline sequence.
 * @param params.synchronize - Runs {@link OnChainAccountService.synchronize} for the account.
 * @param params.readPersistedSequence - Reads sequence from persisted on-chain snapshot.
 * @param params.logger - Logger for retry diagnostics.
 * @param params.delayFn - Optional delay between retry attempts (defaults to {@link delayMilliseconds}).
 */
export async function reconcileAfterRpcSuccess(params: {
  mode: TrackTransactionOnChainReconciliation;
  context: ReconciliationContext;
  synchronize: () => Promise<void>;
  readPersistedSequence: () => Promise<string | null>;
  logger: ILogger;
  delayFn?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const {
    mode,
    context,
    synchronize,
    readPersistedSequence,
    logger,
    delayFn = delayMilliseconds,
  } = params;

  if (mode === TrackTransactionOnChainReconciliation.None) {
    await synchronize();
    return;
  }

  const { baselineSequence, accountId, scope } = context;

  for (
    let attempt = 0;
    attempt < HORIZON_RECONCILIATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    await synchronize();

    const currentSequence = await readPersistedSequence();
    if (
      currentSequence !== null &&
      isSequenceAdvanced(baselineSequence, currentSequence)
    ) {
      logger.info(
        'TrackTransaction: persisted account sequence advanced after RPC success',
        {
          attempt,
          accountId,
          scope,
          baselineSequence,
          currentSequence,
        },
      );
      return;
    }

    if (attempt < HORIZON_RECONCILIATION_MAX_ATTEMPTS - 1) {
      logger.warn(
        'TrackTransaction: Horizon sequence not yet advanced; retrying sync',
        {
          attempt,
          accountId,
          scope,
          baselineSequence,
          currentSequence,
        },
      );
      await delayFn(HORIZON_RECONCILIATION_DELAY_MS);
    }
  }

  logger.warn(
    'TrackTransaction: Horizon sequence reconciliation exhausted attempts',
    {
      accountId,
      scope,
      baselineSequence,
      maxAttempts: HORIZON_RECONCILIATION_MAX_ATTEMPTS,
    },
  );
}
