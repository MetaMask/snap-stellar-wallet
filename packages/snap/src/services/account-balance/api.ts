import type { Balance } from '@metamask/keyring-api';

import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';

export type BaseAssetBalance = Balance;

export type TrustLineAssetBalance = BaseAssetBalance & {
  /** The limit of the balance. */
  limit: string;
  /** Horizon `is_authorized` for this trustline (optional for legacy persisted rows). */
  authorized?: boolean;
  /** The sponsored balance. */
  sponsored?: boolean;
};

/**
 * Per-account balances keyed by native slip44, classic, or SEP-41 CAIP-19 asset id.
 *
 * For the slip44 native entry, `amount` is the **total** balance in stroops (same as Horizon native before reserve subtraction). Spendable XLM is derived at bind time from this value plus account metadata (subentries / sponsoring).
 */
export type AccountBalance = Partial<
  Record<KnownCaip19AssetIdOrSlip44Id, BaseAssetBalance | TrustLineAssetBalance>
>;

/** Wrapper persisted under `accountBalances[accountId]` with a single write timestamp for the row. */
export type AccountBalanceRecord = {
  balances: AccountBalance;
  persistedAt: number;
};

/** Snap state slice: `accountBalances[accountId]` → per-asset balances for that keyring account. */
export type AccountBalanceState = {
  accountBalances: Record<string, AccountBalanceRecord>;
};
