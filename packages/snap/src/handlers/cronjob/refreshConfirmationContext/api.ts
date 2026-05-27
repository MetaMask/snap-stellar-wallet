import { enums } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import type {
  ContextWithPrices,
  ContextWithTransactionScan,
} from '../../../ui/confirmation/api';

/** Identifies which confirmation context refreshers to run for a cron cycle. */
export enum ConfirmationContextRefresherKey {
  Prices = 'prices',
  /** TODO: Reserved for security scan; wire in context when implemented. */
  Scan = 'scan',
  Transaction = 'transaction',
}

export const ConfirmationContextRefresherKeyStruct = enums(
  Object.values(ConfirmationContextRefresherKey),
);

/**
 * Context the handler passes to refreshers.
 */
export type ConfirmationDataContext = Record<string, Json> &
  ContextWithPrices &
  ContextWithTransactionScan;

/** Outcome of one refresher cycle. `null` means no work was needed. */
export type ConfirmationContextRefreshResult = {
  result: Record<string, Json>;
  reschedule: boolean;
} | null;

/**
 * Contract for a single background data source (prices, security scan, …).
 */
export type IConfirmationContextRefresher = {
  /** Stable id used in cron params to select this refresher. */
  readonly key: ConfirmationContextRefresherKey;

  /**
   * Returns whether this cycle should call.
   * When false, the handler uses {@link IConfirmationContextRefresher.recoveryResult} instead.
   */
  shouldFetch: (ctx: ConfirmationDataContext) => boolean;

  /**
   * Patch applied when {@link IConfirmationContextRefresher.shouldFetch} is false
   * (e.g. clear a stuck loading state). Return `null` when the context is already settled.
   */
  recoveryResult: (
    ctx: ConfirmationDataContext,
  ) => ConfirmationContextRefreshResult;

  /**
   * Fetches fresh data when {@link IConfirmationContextRefresher.shouldFetch} is true.
   */
  refresh: (
    ctx: ConfirmationDataContext,
  ) => Promise<ConfirmationContextRefreshResult>;

  /**
   * Returns false when this refresher cannot safely read `ctx` (missing or
   * malformed fields). Only enabled refreshers (by key) are validated and run.
   */
  isValidContext: (ctx: Record<string, Json>) => boolean;
};

/** Composed refreshers passed into the confirmation context handler. */
export type ConfirmationContextRefreshers =
  readonly IConfirmationContextRefresher[];
