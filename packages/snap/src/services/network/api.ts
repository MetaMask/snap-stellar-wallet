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
