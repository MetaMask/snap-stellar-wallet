import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';

/**
 * Snap-state transaction with optional reconcile metadata.
 * `reconcileAttemptCount` is internal-only and must be stripped before keyring emit/read APIs.
 */
export type StellarKeyringTransaction = KeyringTransaction & {
  reconcileAttemptCount?: number;
};

/**
 * The order of onChain transactions to fetch.
 */
export enum TransactionOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * The type of Stellar operation.
 *
 * @see https://stellar.org/developers/guides/concepts/list-of-operations.html
 */
export enum StellarOperationType {
  AccountMerge = 'accountMerge',
  AllowTrust = 'allowTrust',
  BeginSponsoringFutureReserves = 'beginSponsoringFutureReserves',
  BumpSequence = 'bumpSequence',
  ChangeTrust = 'changeTrust',
  ClaimClaimableBalance = 'claimClaimableBalance',
  Clawback = 'clawback',
  ClawbackClaimableBalance = 'clawbackClaimableBalance',
  CreateAccount = 'createAccount',
  CreateClaimableBalance = 'createClaimableBalance',
  CreatePassiveSellOffer = 'createPassiveSellOffer',
  EndSponsoringFutureReserves = 'endSponsoringFutureReserves',
  ExtendFootprintTtl = 'extendFootprintTtl',
  Inflation = 'inflation',
  InvokeHostFunction = 'invokeHostFunction',
  LiquidityPoolDeposit = 'liquidityPoolDeposit',
  LiquidityPoolWithdraw = 'liquidityPoolWithdraw',
  ManageBuyOffer = 'manageBuyOffer',
  ManageData = 'manageData',
  ManageSellOffer = 'manageSellOffer',
  PathPaymentStrictReceive = 'pathPaymentStrictReceive',
  PathPaymentStrictSend = 'pathPaymentStrictSend',
  Payment = 'payment',
  RestoreFootprint = 'restoreFootprint',
  RevokeSponsorship = 'revokeSponsorship',
  SetOptions = 'setOptions',
  SetTrustLineFlags = 'setTrustLineFlags',
}
