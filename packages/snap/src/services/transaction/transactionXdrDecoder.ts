import { Asset, StrKey, xdr } from '@stellar/stellar-sdk';

import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { getSlip44AssetId, toCaip19ClassicAssetId } from '../../utils';
import { bufferToUint8Array } from '../../utils/buffer';

export enum TransactionResultType {
  PathPaymentStrictSendSuccess = 'pathPaymentStrictSendSuccess',
  PathPaymentStrictReceiveSuccess = 'pathPaymentStrictReceiveSuccess',
}

type TransactionResultAsset =
  | KnownCaip19ClassicAssetId
  | KnownCaip19Slip44Id
  | undefined;

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
          const pathPaymentStrictSendSuccess = tr
            .pathPaymentStrictSendResult()
            .success();
          const last = pathPaymentStrictSendSuccess.last();
          operationResults.push({
            type: TransactionResultType.PathPaymentStrictSendSuccess,
            amount: last.amount().toString(),
            asset: xdrAssetToCaip19(last.asset(), scope),
            destination: xdrPublicKeyToAddress(last.destination()),
          });
        } else if (
          name === TransactionResultType.PathPaymentStrictReceiveSuccess
        ) {
          const pathPaymentStrictReceiveSuccess = tr
            .pathPaymentStrictReceiveResult()
            .success();
          const last = pathPaymentStrictReceiveSuccess.last();
          operationResults.push({
            type: TransactionResultType.PathPaymentStrictReceiveSuccess,
            amount: last.amount().toString(),
            asset: xdrAssetToCaip19(last.asset(), scope),
            destination: xdrPublicKeyToAddress(last.destination()),
          });
        } else {
          operationResults.push(null);
        }
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
