import type { Infer } from '@metamask/superstruct';
import {
  enums,
  object,
  assign,
  literal,
  optional,
  boolean,
  string,
  type,
  union,
  refine,
} from '@metamask/superstruct';
import type { JsonRpcRequest } from '@metamask/utils';
import { base64, parseCaipAssetType } from '@metamask/utils';

import {
  JsonRpcRequestStruct,
  KnownCaip2ChainIdStruct,
  KnownCaip19ClassicAssetStruct,
  UuidStruct,
  NonZeroValidAmountStruct,
} from '../../api';

export enum MultiChainSendErrorCodes {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Required = 'Required',
  Invalid = 'Invalid',
  InsufficientBalance = 'InsufficientBalance',
  InsufficientBalanceToCoverFee = 'InsufficientBalanceToCoverFee',
}

/**
 * Enum for the client request method.
 */
export enum ClientRequestMethod {
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
    limit: literal('0'),
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
    return `Asset id ${params.assetId} scope is not match with the request scope ${params.scope}`;
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
