import { nonempty, refine, string } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';
import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder as StellarSdkTransactionBuilder,
  hash,
  xdr,
} from '@stellar/stellar-sdk';

import { bufferToUint8Array } from '../utils/buffer';

/**
 * Validation struct for XDR: must be a valid base64 encoded XDR string.
 */
export const XdrStruct = refine(
  nonempty(base64(string())),
  'valid_xdr',
  (value: string) => {
    try {
      if (!xdr.TransactionEnvelope.validateXDR(value, 'base64')) {
        return 'Invalid XDR';
      }
      return true;
    } catch {
      return 'Invalid XDR';
    }
  },
);

/**
 * Gets operation types from a base64 transaction envelope XDR.
 *
 * @param value - The base64 transaction envelope XDR.
 * @returns Operation type strings in envelope order.
 */
function getTransactionOperationTypes(value: string): string[] {
  const transaction = StellarSdkTransactionBuilder.fromXDR(
    value,
    Networks.PUBLIC,
  );
  const operations =
    transaction instanceof FeeBumpTransaction
      ? transaction.innerTransaction.operations
      : transaction.operations;

  return operations.map((operation) => operation.type);
}

/**
 * Checks if the operation type is one of the Stellar path payment variants.
 *
 * @param operationType - The Stellar SDK operation type string.
 * @returns True when the operation is a path payment.
 */
function isPathPaymentOperation(operationType: string | undefined): boolean {
  return (
    operationType === 'pathPaymentStrictSend' ||
    operationType === 'pathPaymentStrictReceive'
  );
}

/**
 * Validation struct for swap transaction XDRs accepted by the CrossChain flow.
 *
 * Supported operation shapes:
 * - `invokeHostFunction`: Soroban swaps are assembled as a single contract
 * invocation; resource fee and authorization checks happen later in the
 * transaction flow.
 * - `payment`: bridge deposit routes are represented on Stellar as a single
 * payment to the bridge deposit account. Destination and memo expectations are
 * owned by the CrossChain quote / approval layer; this struct only gates the
 * operation shape before Stellar-level validation runs downstream.
 * - `pathPayment*`, `payment`: classic swaps use the path payment for the
 * asset exchange, followed by the fee-send payment appended to the route.
 * - `changeTrust`, `pathPayment*`, `payment`: same classic swap shape, with a
 * leading trustline setup for destination assets the wallet cannot receive yet.
 *
 * This struct intentionally validates only operation order and operation kind.
 * Account, balance, trustline, and Soroban simulation checks are handled by the
 * transaction service and simulator after the request shape is accepted.
 */
export const SwapTransactionXdrStruct = refine(
  XdrStruct,
  'valid_swap_transaction_xdr',
  (value: string) => {
    try {
      const operationTypes = getTransactionOperationTypes(value);
      const [firstOperation, secondOperation, thirdOperation] = operationTypes;

      // Soroban swap route or bridge deposit route.
      if (
        operationTypes.length === 1 &&
        (firstOperation === 'invokeHostFunction' ||
          firstOperation === 'payment')
      ) {
        return true;
      }

      // Classic route: path payment performs the swap, then payment sends the route fee.
      if (
        operationTypes.length === 2 &&
        isPathPaymentOperation(firstOperation) &&
        secondOperation === 'payment'
      ) {
        return true;
      }

      // Classic route requiring a new destination-asset trustline first.
      if (
        operationTypes.length === 3 &&
        firstOperation === 'changeTrust' &&
        isPathPaymentOperation(secondOperation) &&
        thirdOperation === 'payment'
      ) {
        return true;
      }

      return 'Unsupported swap transaction operation shape';
    } catch {
      return 'Invalid swap transaction XDR';
    }
  },
);

// SHA-256 of the Stellar mainnet passphrase. Cached so the refine below
// doesn't re-hash on every validation. This is the value the network compares
// against when verifying a Soroban authorization signature, so the embedded
// `networkId` of any preimage we agree to sign must equal it.
const MAINNET_NETWORK_ID = hash(bufferToUint8Array(Networks.PUBLIC, 'utf8'));

/**
 * Validation struct for a SEP-43 `signAuthEntry` payload: a base64-encoded
 * `HashIdPreimage` whose discriminant is `envelopeTypeSorobanAuthorization`
 * AND whose embedded `networkId` matches Stellar mainnet. Anything else is
 * rejected at the struct level so the handler can return -3 InvalidRequest.
 *
 * The `networkId` check matters because — unlike `signTransaction`, where the
 * network passphrase is supplied by the signer — `signAuthEntry` SHA-256s the
 * raw preimage and signs the digest as-is. The dapp therefore controls the
 * network the resulting signature is valid against, and a mainnet-only snap
 * must reject preimages bound to any other network even if the keyring `scope`
 * and `opts.networkPassphrase` look mainnet-y.
 */
export const HashIdPreimageXdrStruct = refine(
  nonempty(base64(string())),
  'valid_soroban_auth_preimage',
  (value: string) => {
    try {
      const preimage = xdr.HashIdPreimage.fromXDR(value, 'base64');
      if (
        preimage.switch() !==
        xdr.EnvelopeType.envelopeTypeSorobanAuthorization()
      ) {
        return 'HashIdPreimage is not a Soroban authorization preimage';
      }
      const embeddedNetworkId = preimage.sorobanAuthorization().networkId();
      if (!MAINNET_NETWORK_ID.equals(embeddedNetworkId)) {
        return 'HashIdPreimage networkId is not Stellar mainnet';
      }
      return true;
    } catch {
      return 'Invalid HashIdPreimage XDR';
    }
  },
);
