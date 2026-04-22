import type { Operation } from '@stellar/stellar-sdk';

import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../../api';

export type Sep41TokenBalanceMapKey = `${string}-${KnownCaip19Sep41AssetId}`;

/**
 * Trustline row for simulation. `sponsored` mirrors Horizon: non-empty `balance.sponsor` means reserve is sponsored.
 */
export type TrustlineState = {
  balance: BigNumber;
  limit: BigNumber;
  /**
   * Horizon `is_authorized`: when false, the account cannot send or receive this credit asset
   * (issuer auth required / revoked).
   */
  authorized: boolean;
  /** When true, this line's reserve is counted in the account's `numSponsored` (not self-paid). */
  sponsored: boolean;
};

/**
 * Per-account view used for ordered (stack-based) simulation of classic operations.
 * Amounts are in stroops / smallest units; trustline limit and balance match Horizon semantics.
 */
export type AccountState = {
  nativeRawBalance: BigNumber;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  trustlines: Map<KnownCaip19ClassicAssetId, TrustlineState>;
};

/**
 * Global simulation: keyed by account id (G… only; muxed ids resolved to base account).
 */
export type SimulationState = {
  /**
   * Map of account id to account state.
   */
  accounts: Map<string, AccountState>;
  /**
   * Optional map for preloaded SEP-41 token balances.
   */
  preloadedTokenBalance?: Map<Sep41TokenBalanceMapKey, BigNumber>;
};

/**
 * Context for validating one classic operation against the current simulation snapshot.
 */
export type Context = {
  state: SimulationState;
  txSource: string;
  scope: KnownCaip2ChainId;
  opIndex: number;
};

/**
 * Validates and applies a single supported classic operation against {@link SimulationState}.
 */
export type OperationSimulator = {
  validate(
    ctx: Context,
    op: Operation,
    allOperations?: readonly Operation[],
  ): void;
  apply(ctx: Context, op: Operation): void;
};
