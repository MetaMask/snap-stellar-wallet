import { Asset, StrKey, xdr } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
} from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toDisplayBalance,
} from '../../utils';
import { bufferToUint8Array } from '../../utils/buffer';

export enum TransactionResultType {
  PathPaymentStrictSendSuccess = 'pathPaymentStrictSendSuccess',
  PathPaymentStrictReceiveSuccess = 'pathPaymentStrictReceiveSuccess',
}

type TransactionResultAsset =
  | KnownCaip19ClassicAssetId
  | KnownCaip19Slip44Id
  | undefined;

type AssetAndAmount = {
  amount: BigNumber;
  asset: TransactionResultAsset;
  destination: string | undefined;
};
/**
 * Parsed outcome for a single successful path-payment operation.
 *
 * `amount` and `asset` always describe the side extracted from the transaction
 * result XDR that is not fixed by the operation envelope:
 * - {@link TransactionResultType.PathPaymentStrictSendSuccess}: destination (receive) amount and asset from `last`.
 * - {@link TransactionResultType.PathPaymentStrictReceiveSuccess}: source (send) amount and asset from the first path offer's `amountBought` / `assetBought` (not the receive amount/asset in `last`).
 */
type OperationResult =
  | {
      type: TransactionResultType.PathPaymentStrictSendSuccess;
      amount: string;
      asset: TransactionResultAsset;
      destination: string | undefined;
    }
  | {
      type: TransactionResultType.PathPaymentStrictReceiveSuccess;
      amount: string;
      asset: TransactionResultAsset;
      destination: string | undefined;
    }
  | null;

export type SuccessfulTransactionResult = {
  operationResults: OperationResult[];
  feeCharged: string;
};

/**
 * Parses a successful Stellar transaction result XDR into operation-level outcomes.
 *
 * Only path-payment success results are decoded; other operations are returned as `null`
 * placeholders so `operationResults` stays aligned with operation index.
 *
 * For each path-payment type, `amount` and `asset` are the variable side of the swap
 * (the side not already known from the operation envelope):
 *
 * PathPaymentStrictSendSuccess: destination receive amount and asset from `last`.
 *
 * PathPaymentStrictReceiveSuccess: source send amount and asset from the first path
 * offer's `amountBought` / `assetBought`, not the receive amount and asset in `last`
 * (those match the operation's fixed `destAmount` / `destAsset`).
 *
 * All amounts are display-formatted (e.g. stroops converted to lumens).
 *
 * @param xdrString - Base64-encoded `TransactionResult` XDR from Horizon.
 * @param scope - CAIP-2 chain used to encode parsed asset ids.
 * @returns Parsed fee and per-operation path payment results, or `null` when parsing fails.
 */
export function parseSuccessfulTransactionResult(
  xdrString: string,
  scope: KnownCaip2ChainId,
): SuccessfulTransactionResult | null {
  try {
    const transactionResult = xdr.TransactionResult.fromXDR(
      bufferToUint8Array(xdrString, 'base64'),
    );
    const feeCharged = transactionResult.feeCharged().toString();
    const operationResults: OperationResult[] = [];

    const result = transactionResult.result();
    if (result.switch().name !== 'txSuccess') {
      return null;
    }

    for (const opResult of result.results()) {
      const tr = opResult.tr();
      const { name } = tr.value().switch();

      try {
        if (name === TransactionResultType.PathPaymentStrictSendSuccess) {
          const success = tr.pathPaymentStrictSendResult().success();
          const receiveSide = extractLastReceiveSide(success.last(), scope);

          if (receiveSide) {
            operationResults.push({
              type: TransactionResultType.PathPaymentStrictSendSuccess,
              amount: toDisplayBalance(receiveSide.amount),
              asset: receiveSide.asset,
              destination: receiveSide.destination,
            });
            continue;
          }
        } else if (
          name === TransactionResultType.PathPaymentStrictReceiveSuccess
        ) {
          const success = tr.pathPaymentStrictReceiveResult().success();
          const sendSide = extractFirstOfferSendSide(
            success.offers()[0],
            success.last(),
            scope,
          );

          if (sendSide) {
            operationResults.push({
              type: TransactionResultType.PathPaymentStrictReceiveSuccess,
              amount: toDisplayBalance(sendSide.amount),
              asset: sendSide.asset,
              destination: sendSide.destination,
            });
            continue;
          }
        }
        operationResults.push(null);
      } catch {
        // Preserve operation index alignment when a single result cannot be parsed.
        operationResults.push(null);
      }
    }

    return {
      operationResults,
      feeCharged,
    };
  } catch {
    return null;
  }
}

/**
 * Maps an XDR asset to a CAIP-19 asset id supported by the snap.
 *
 * @param asset - XDR asset from a transaction result.
 * @param scope - CAIP-2 chain used to encode the asset id.
 * @returns CAIP-19 asset id, or `undefined` when the asset is unsupported (e.g. pool shares).
 */
export function xdrAssetToCaip19(
  asset: xdr.Asset,
  scope: KnownCaip2ChainId,
): TransactionResultAsset {
  switch (asset.switch().name) {
    case 'assetTypeNative':
      return getSlip44AssetId(scope);
    case 'assetTypeCreditAlphanum4':
    case 'assetTypeCreditAlphanum12': {
      try {
        const stellarAsset = Asset.fromOperation(asset);
        return toCaip19ClassicAssetId(
          scope,
          stellarAsset.getCode(),
          stellarAsset.getIssuer(),
        );
      } catch {
        return undefined;
      }
    }
    // Pool-share assets (e.g. AMM path routes) are not mapped to CAIP-19.
    case 'assetTypePoolShare':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Encodes an XDR public key as a Stellar account address.
 *
 * @param publicKey - Destination public key from a path payment result.
 * @returns StrKey-encoded Stellar address.
 */
function xdrPublicKeyToAddress(publicKey: xdr.PublicKey): string | undefined {
  switch (publicKey.switch().name) {
    case 'publicKeyTypeEd25519':
      return StrKey.encodeEd25519PublicKey(publicKey.ed25519());
    default:
      return undefined;
  }
}

/**
 * Extracts receive-side amount, asset, and destination from the `last` payment result.
 *
 * @param last - Final `SimplePaymentResult` from the path payment result.
 * @param scope - CAIP-2 chain used to encode the asset id.
 * @returns Receive amount, asset, and destination, or `undefined` when `last` is missing.
 */
function extractLastReceiveSide(
  last: xdr.SimplePaymentResult | undefined,
  scope: KnownCaip2ChainId,
): AssetAndAmount | undefined {
  if (!last) {
    return undefined;
  }

  return {
    amount: new BigNumber(last.amount().toString()),
    asset: xdrAssetToCaip19(last.asset(), scope),
    destination: xdrPublicKeyToAddress(last.destination()),
  };
}

/**
 * Extracts send-side amount and asset from the first path offer of a strict-receive payment,
 * with destination from `last`.
 *
 * @param offer - First `ClaimAtom` from the path payment result.
 * @param last - Final `SimplePaymentResult` from the path payment result.
 * @param scope - CAIP-2 chain used to encode the asset id.
 * @returns Send amount, asset, and destination, or `undefined` when inputs are missing or unsupported.
 */
function extractFirstOfferSendSide(
  offer: xdr.ClaimAtom | undefined,
  last: xdr.SimplePaymentResult | undefined,
  scope: KnownCaip2ChainId,
): AssetAndAmount | undefined {
  if (!offer || !last) {
    return undefined;
  }

  let claim:
    | {
        amountBought(): xdr.Int64;
        assetBought(): xdr.Asset;
      }
    | undefined;

  switch (offer.switch().name) {
    case 'claimAtomTypeOrderBook':
      claim = offer.orderBook();
      break;
    case 'claimAtomTypeLiquidityPool':
      claim = offer.liquidityPool();
      break;
    case 'claimAtomTypeV0':
      claim = offer.v0();
      break;
    default:
      return undefined;
  }

  return {
    amount: new BigNumber(claim.amountBought().toString()),
    asset: xdrAssetToCaip19(claim.assetBought(), scope),
    destination: xdrPublicKeyToAddress(last.destination()),
  };
}
