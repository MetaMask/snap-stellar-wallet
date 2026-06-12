import type { Operation } from '@stellar/stellar-sdk';
import {
  Asset,
  StrKey,
  xdr,
  scValToNative,
  Address,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionXdrDecoderException } from './exceptions';
import {
  StellarAddressOrContractStruct,
  type KnownCaip19ClassicAssetId,
  type KnownCaip19Sep41AssetId,
  type KnownCaip19Slip44Id,
  type KnownCaip2ChainId,
} from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
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

export type ParsedSep41TransferInvoke = {
  /**
   * Canonical SEP-41 CAIP-19 id for the **invoked contract** — not a separate XDR field.
   * Same encoding as {@link TransactionBuilder.sep41Transfer}: `toCaip19Sep41AssetId(scope, contractId)`.
   */
  assetId: KnownCaip19Sep41AssetId;
  fromAccountId: string;
  toAccountId: string;
  amount: BigNumber;
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
 * Returns whether the operation invokes a contract `transfer(from, to, amount)`.
 *
 * @param op - Parsed `invokeHostFunction` operation.
 * @returns True when the invoke target is a contract `transfer` call.
 */
export function isSep41TransferInvoke(
  op: Operation.InvokeHostFunction,
): boolean {
  const { func } = op;
  if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
    return false;
  }
  return func.invokeContract().functionName().toString() === 'transfer';
}

/**
 * Parses a SEP-41 `transfer(from, to, amount)` invoke operation.
 *
 * Reads **contract address** from the invoke target and **derives** the CAIP-19 asset id with `scope`
 * (the envelope never embeds a CAIP string — only `C…` like `Contract.call`).
 * {@link TransactionBuilder.sep41Transfer} is the same function that is used to build the transaction.
 *
 * @param op - Parsed `invokeHostFunction` operation.
 * @param scope - CAIP-2 chain id (must match the envelope network when matching preload keys).
 * @returns Parsed transfer metadata.
 * @throws {TransactionXdrDecoderException} When the operation is not a valid SEP-41 transfer invoke.
 */
export function parseSep41TransferInvoke(
  op: Operation.InvokeHostFunction,
  scope: KnownCaip2ChainId,
): ParsedSep41TransferInvoke {
  const { func } = op;
  if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
    throw new TransactionXdrDecoderException(
      'Not an invoke contract operation',
    );
  }
  const ic = func.invokeContract();
  if (ic.functionName().toString() !== 'transfer') {
    throw new TransactionXdrDecoderException(
      'Contract is not a transfer function',
    );
  }

  const args = ic.args();
  if (
    args.length !== 3 ||
    args[0] === undefined ||
    args[1] === undefined ||
    args[2] === undefined
  ) {
    throw new TransactionXdrDecoderException(
      'Invalid transfer function arguments',
    );
  }

  const contractAddr = Address.fromScAddress(ic.contractAddress()).toString();

  const fromNative = scValToNative(args[0]);
  const toNative = scValToNative(args[1]);
  const amountNative = scValToNative(args[2]);
  if (
    typeof fromNative !== 'string' ||
    !StellarAddressOrContractStruct.is(fromNative)
  ) {
    throw new TransactionXdrDecoderException('Invalid from address');
  }
  if (
    typeof toNative !== 'string' ||
    !StellarAddressOrContractStruct.is(toNative)
  ) {
    throw new TransactionXdrDecoderException('Invalid to address');
  }

  return {
    assetId: toCaip19Sep41AssetId(scope, contractAddr),
    fromAccountId: fromNative,
    toAccountId: toNative,
    amount: parseScValToNative(amountNative),
  };
}

/**
 * Parses a SEP-41 transfer invoke without throwing.
 *
 * @param op - Parsed `invokeHostFunction` operation.
 * @param scope - CAIP-2 chain id (must match the envelope network when matching preload keys).
 * @returns Parsed transfer metadata, or `null` if the shape does not match.
 */
export function parseSep41TransferInvokeSafe(
  op: Operation.InvokeHostFunction,
  scope: KnownCaip2ChainId,
): ParsedSep41TransferInvoke | null {
  if (!isSep41TransferInvoke(op)) {
    return null;
  }
  try {
    return parseSep41TransferInvoke(op, scope);
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
 * Parses a XDR value from a string, bigint, or number.
 *
 * @param value - The value to parse.
 * @returns The parsed amount in BigNumber.
 * @throws {TransactionXdrDecoderException} If the value is not a valid native value.
 */
export function parseScValToNative(value: string | bigint | number): BigNumber {
  let amountStr: string;
  if (typeof value === 'bigint') {
    amountStr = value.toString();
  } else if (typeof value === 'number') {
    amountStr = String(Math.trunc(value));
  } else {
    amountStr = String(value);
  }
  const amountBn = new BigNumber(amountStr);
  if (!amountBn.isFinite() || amountBn.isNegative()) {
    throw new TransactionXdrDecoderException(`Invalid native value: ${value}`);
  }
  return amountBn;
}

/**
 * Extracts token metadata from a contract data ledger entry.
 *
 * @param contractData - The contract data entry.
 * @param contractAddress - Token contract id strkey (`C…`) for error context and wasm token `assetRef`.
 * @returns Token name, symbol, decimals, and whether the contract wraps a classic asset.
 */
export function extractAssetDataFromContractData(
  contractData: xdr.ContractDataEntry,
  contractAddress: string,
): {
  name: string;
  symbol: string;
  decimals: number;
  isStellarClassicAsset: boolean;
} {
  try {
    const contractDataInstance = contractData.val().instance();

    // contractDataName is either contractExecutableWasm or contractExecutableStellarAsset
    // contractExecutableWasm: Wasm contract
    // contractExecutableStellarAsset: Stellar asset contract
    const contractDataName = contractDataInstance.executable().switch().name;

    const isStellarClassicAsset =
      contractDataName === 'contractExecutableStellarAsset';

    const assetData = {
      symbol: '',
      decimals: -1,
      name: '',
      isStellarClassicAsset,
    };

    // it is possible to have empty storage, such as when the contract is not a token contract
    for (const entry of contractDataInstance?.storage() ?? []) {
      const key = entry.key();
      const keyName = key.switch().name;

      if (keyName !== 'scvSymbol' || key.sym().toString() !== 'METADATA') {
        continue;
      }

      for (const mapEntry of entry.val().map() ?? []) {
        const fieldName = mapEntry.key().sym().toString();
        const value = mapEntry.val();

        switch (fieldName) {
          case 'name':
            // if it is a Stellar asset contract, the name is ${ASSET_CODE}:${ASSET_ISSUER}
            // if it is a Wasm contract, the "name" is set to the contract address (used as the SEP-41 assetRef/identifier)
            assetData.name = isStellarClassicAsset
              ? value.str().toString()
              : contractAddress;
            break;
          case 'symbol':
            assetData.symbol = value.str().toString();
            break;
          case 'decimal':
            assetData.decimals = value.u32();
            break;
          default:
            break;
        }
      }
    }
    if (assetData.name === '') {
      throw new TransactionXdrDecoderException(
        `Name is empty for contract ${contractAddress}`,
      );
    }
    if (assetData.symbol === '') {
      throw new TransactionXdrDecoderException(
        `Symbol is empty for contract ${contractAddress}`,
      );
    }
    if (assetData.decimals === -1) {
      throw new TransactionXdrDecoderException(
        `Decimals is empty for contract ${contractAddress}`,
      );
    }

    return assetData;
  } catch (error) {
    if (error instanceof TransactionXdrDecoderException) {
      throw error;
    }
    throw new TransactionXdrDecoderException(
      `Error extracting asset data from contract ${contractAddress}`,
    );
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
