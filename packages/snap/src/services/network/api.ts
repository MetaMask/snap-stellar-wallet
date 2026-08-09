import {
  array,
  boolean,
  number,
  optional,
  record,
  string,
  type,
  union,
} from '@metamask/superstruct';

import type { KnownCaip19AssetId } from '../../api';

/**
 * The known RPC error codes for the Stellar network.
 * The error code is shared with Horizon API and Soroban RPC.
 *
 * @see https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions
 */
export enum KnownRpcError {
  TxBadSeq = 'txBadSeq',
  TxBadAuth = 'txBadAuth',
  TxTooEarly = 'txTooEarly',
  TxTooLate = 'txTooLate',
  TxInsufficientFee = 'txInsufficientFee',
  TxInsufficientBalance = 'txInsufficientBalance',
  TxInsufficientReserve = 'txInsufficientReserve',
  TxFailed = 'txFailed',
  TxMissingOperation = 'txMissingOperation',
  TxInternalError = 'txInternalError',
  TxBadAuthExtra = 'txBadAuthExtra',
}

/**
 * Asset data for a Stellar classic asset.
 */
export type AssetDataResponse = {
  name?: string;
  // Symbol of the asset
  symbol: string;
  // Number of decimal places of the asset
  decimals: number;
  // CAIP-19 classic asset id (`…/asset:CODE-ISSUER`) from RPC / Stellar asset contract
  assetId: KnownCaip19AssetId;
};

/**
 * Validation structs for the fields the snap consumes from raw Horizon JSON responses.
 * Responses the SDK already validates on construction (base `Account` from `loadAccount`
 * / RPC `getAccount`, XDR-parsed RPC results) are not re-validated here.
 *
 * They intentionally use `type` (not `object`) so that unlisted fields of these
 * responses are neither rejected nor stripped.
 */

/** Horizon account balance line. */
export const HorizonBalanceLineStruct = type({
  balance: string(),
  asset_type: string(),
  asset_code: optional(string()),
  asset_issuer: optional(string()),
  limit: optional(string()),
  is_authorized: optional(boolean()),
  sponsor: optional(string()),
});

/** Horizon `loadAccount` response fields (id and sequence are validated by the SDK constructor). */
export const HorizonAccountResponseStruct = type({
  subentry_count: optional(number()),
  num_sponsoring: optional(number()),
  num_sponsored: optional(number()),
  data_attr: optional(record(string(), string())),
  balances: optional(array(HorizonBalanceLineStruct)),
});

/** Horizon transaction record. */
export const HorizonTransactionRecordStruct = type({
  envelope_xdr: string(),
  fee_charged: union([string(), number()]),
  successful: boolean(),
  source_account: string(),
  paging_token: string(),
});

/** Horizon transaction record, reduced to the ledger outcome. */
export const HorizonTransactionInclusionStruct = type({
  successful: boolean(),
});

/** Horizon transactions collection page. */
export const HorizonTransactionPageStruct = type({
  records: array(HorizonTransactionRecordStruct),
});

/** Horizon assets collection page. */
export const HorizonAssetPageStruct = type({
  records: array(
    type({
      asset_code: string(),
      asset_issuer: string(),
    }),
  ),
});
