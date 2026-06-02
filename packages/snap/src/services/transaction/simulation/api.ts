import type { Operation } from '@stellar/stellar-sdk';

import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../../api';
import type { Transaction } from '../Transaction';

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
  requiresMemo: boolean;
  trustlines: Map<KnownCaip19ClassicAssetId, TrustlineState>;
  /**
   * SEP-41 contract token balances from the wallet snapshot (smallest units), keyed by CAIP-19 SEP-41 id.
   */
  sep41Balances: Map<KnownCaip19Sep41AssetId, BigNumber>;
};

/**
 * Global simulation: keyed by account id (G… only; muxed ids resolved to base account).
 */
export type SimulationState = {
  /**
   * Map of account id to account state.
   */
  accounts: Map<string, AccountState>;
};

/** Per-operation context for balance / trustline apply steps. */
export type ApplyContext = {
  state: SimulationState;
  txSource: string;
  scope: KnownCaip2ChainId;
  opIndex: number;
};

/** Extends {@link ApplyContext} with the envelope (e.g. memo checks on payment validation). */
export type ValidateContext = ApplyContext & {
  transaction: Transaction;
};

/**
 * Validates and applies a single supported classic operation against {@link SimulationState}.
 */
export type OperationSimulator = {
  validate(
    ctx: ValidateContext,
    op: Operation,
    allOperations?: readonly Operation[],
  ): void;
  apply(ctx: ApplyContext, op: Operation): void;
};
