import { AssetStruct, FeeType } from '@metamask/keyring-api';
import type { Infer } from '@metamask/superstruct';
import {
  enums,
  object,
  assign,
  literal,
  optional,
  boolean,
  string,
  nonempty,
  type,
  union,
  refine,
  integer,
  min,
  array,
} from '@metamask/superstruct';
import type { JsonRpcRequest } from '@metamask/utils';
import { base64, definePattern, parseCaipAssetType } from '@metamask/utils';

import {
  JsonRpcRequestStruct,
  KnownCaip2ChainIdStruct,
  KnownCaip19ClassicAssetStruct,
  UuidStruct,
  NonZeroValidAmountStruct,
  XdrStruct,
} from '../../api';

/**
 * Enum for the client request method.
 */
export enum ClientRequestMethod {
  /** -------------------------------- Wallet Standard -------------------------------- */
  // Standard multichain workflow for bridge
  SignAndSendTransaction = 'signAndSendTransaction',
  ComputeFee = 'computeFee',
  /** -------------------------------- Stellar Specific -------------------------------- */
  ChangeTrustOpt = 'changeTrustOpt',
}

/**
 * Trustline change intent for {@link ClientRequestMethod.ChangeTrustOpt}.
 */
export enum ChangeTrustOptAction {
  Add = 'add',
  Delete = 'delete',
}

/**
 * Validation struct for the client request method.
 */
export const ClientRequestMethodStruct = enums(
  Object.values(ClientRequestMethod),
);

export const JsonRpcRequestWithAccountStruct = assign(
  JsonRpcRequestStruct,
  type({
    params: type({
      accountId: UuidStruct,
    }),
  }),
);

export const ChangeTrustOptActionStruct = enums(
  Object.values(ChangeTrustOptAction),
);

const ChangeTrustBaseParamsStruct = object({
  accountId: UuidStruct,
  assetId: KnownCaip19ClassicAssetStruct,
  scope: KnownCaip2ChainIdStruct,
});

const ChangeTrustAddStruct = assign(
  ChangeTrustBaseParamsStruct,
  object({
    action: literal(ChangeTrustOptAction.Add),
    limit: optional(NonZeroValidAmountStruct),
  }),
);

const ChangeTrustRemoveStruct = assign(
  ChangeTrustBaseParamsStruct,
  object({
    action: literal(ChangeTrustOptAction.Delete),
  }),
);

/**
 * Validation struct for the ChangeTrustOpt JSON-RPC request.
 */
export const ChangeTrustOptJsonRpcRequestStruct = refine(
  assign(
    JsonRpcRequestStruct,
    object({
      method: literal(ClientRequestMethod.ChangeTrustOpt),
      params: union([ChangeTrustAddStruct, ChangeTrustRemoveStruct]),
    }),
  ),
  'change-trust-asset-id-scope-match',
  ({ params }) => {
    const result =
      parseCaipAssetType(params.assetId).chainId === String(params.scope);
    if (result) {
      return true;
    }
    return `The chain implied by asset id ${params.assetId} does not match request scope ${params.scope}`;
  },
);

/**
 * Validation struct for the ChangeTrustOpt JSON-RPC response.
 */
export const ChangeTrustOptJsonRpcResponseStruct = object({
  status: boolean(),
  transactionId: optional(base64(string())),
});

/**
 * Validation struct for the sendTransaction JSON-RPC request.
 */
export const SignAndSendTransactionJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(ClientRequestMethod.SignAndSendTransaction),
    params: object({
      transaction: XdrStruct,
      accountId: UuidStruct,
      scope: KnownCaip2ChainIdStruct,
      options: object({
        visible: optional(boolean()),
        type: nonempty(string()),
      }),
    }),
  }),
);

const StellarTransactionHashStruct = definePattern(
  'StellarTransactionHash',
  /^[0-9a-f]{64}$/iu,
);

/**
 * Validation struct for the sendTransaction JSON-RPC response.
 */
export const SignAndSendTransactionJsonRpcResponseStruct = object({
  transactionId: StellarTransactionHashStruct,
});

/**
 * Validation struct for the computeFee JSON-RPC request.
 */
export const ComputeFeeJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(ClientRequestMethod.ComputeFee),
    params: object({
      transaction: XdrStruct,
      accountId: UuidStruct,
      scope: KnownCaip2ChainIdStruct,
      options: object({
        visible: optional(boolean()),
        type: nonempty(string()),
        feeLimit: optional(min(integer(), 0)),
      }),
    }),
  }),
);

/**
 * Validation struct for the computeFee JSON-RPC response.
 */
export const ComputeFeeJsonRpcResponseStruct = array(
  object({
    type: enums(Object.values(FeeType)),
    asset: AssetStruct,
  }),
);

/**
 * A JSON-RPC request with an account resolve parameter.
 */
export type JsonRpcRequestWithAccount = Infer<
  typeof JsonRpcRequestWithAccountStruct
> &
  JsonRpcRequest;

/**
 * Type for the ChangeTrustOpt JSON-RPC request.
 */
export type ChangeTrustOptJsonRpcRequest = Infer<
  typeof ChangeTrustOptJsonRpcRequestStruct
>;

/**
 * Type for the ChangeTrustOpt JSON-RPC response.
 */
export type ChangeTrustOptJsonRpcResponse = Infer<
  typeof ChangeTrustOptJsonRpcResponseStruct
>;

/**
 * Type for the sendTransaction JSON-RPC request.
 */
export type SignAndSendTransactionJsonRpcRequest = Infer<
  typeof SignAndSendTransactionJsonRpcRequestStruct
>;

/**
 * Type for the sendTransaction JSON-RPC response.
 */
export type SignAndSendTransactionJsonRpcResponse = Infer<
  typeof SignAndSendTransactionJsonRpcResponseStruct
>;

/**
 * Type for the computeFee JSON-RPC request.
 */
export type ComputeFeeJsonRpcRequest = Infer<
  typeof ComputeFeeJsonRpcRequestStruct
>;

/**
 * Type for the computeFee JSON-RPC response.
 */
export type ComputeFeeJsonRpcResponse = Infer<
  typeof ComputeFeeJsonRpcResponseStruct
>;
