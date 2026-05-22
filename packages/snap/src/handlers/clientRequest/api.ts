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
  type,
  union,
  refine,
  array,
  nonempty,
  integer,
  min,
  coerce,
} from '@metamask/superstruct';
import type { JsonRpcRequest } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';

import {
  JsonRpcRequestStruct,
  KnownCaip2ChainIdStruct,
  KnownCaip19ClassicAssetStruct,
  StellarTransactionHashStruct,
  UuidStruct,
  NonZeroValidStellarAmountStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
  StellarAddressStruct,
  ValidAmountStruct,
  ValidStellarAmountStruct,
  SwapTransactionXdrStruct,
} from '../../api';
import { isSep41Id } from '../../utils';

/**
 * Enum for the client request method.
 */
export enum ClientRequestMethod {
  /** -------------------------------- Wallet Standard -------------------------------- */
  OnAddressInput = 'onAddressInput',
  OnAmountInput = 'onAmountInput',
  ConfirmSend = 'confirmSend',
  // Standard multichain workflow for bridge
  SignAndSendTransaction = 'signAndSendTransaction',
  ComputeFee = 'computeFee',
  /** -------------------------------- Stellar Specific -------------------------------- */
  ChangeTrustOpt = 'changeTrustOpt',
}

export enum MultiChainSendErrorCodes {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Required = 'Required',
  Invalid = 'Invalid',
  InsufficientBalance = 'InsufficientBalance',
  InsufficientBalanceToCoverFee = 'InsufficientBalanceToCoverFee',
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
    limit: optional(NonZeroValidStellarAmountStruct),
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
  transactionId: optional(StellarTransactionHashStruct),
});

/**
 * Validation struct for the sendTransaction JSON-RPC request.
 */
export const SignAndSendTransactionJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(ClientRequestMethod.SignAndSendTransaction),
    params: object({
      transaction: SwapTransactionXdrStruct,
      accountId: UuidStruct,
      scope: KnownCaip2ChainIdStruct,
      options: object({
        visible: optional(boolean()),
        type: string(),
      }),
    }),
  }),
);

/**
 * Validation struct for the sendTransaction JSON-RPC response.
 */
export const SignAndSendTransactionJsonRpcResponseStruct = object({
  transactionId: StellarTransactionHashStruct,
});

/*
 * Validation struct for the onAddressInput JSON-RPC request.
 */
export const OnAddressInputJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(ClientRequestMethod.OnAddressInput),
    params: object({
      value: StellarAddressStruct,
    }),
  }),
);

/**
 * Validation struct for the onAddressInput JSON-RPC response.
 */
export const OnAddressInputJsonRpcResponseStruct = object({
  valid: boolean(),
  errors: array(
    object({
      code: string(),
    }),
  ),
});

const OnAmountInputParamsWireStruct = object({
  accountId: UuidStruct,
  assetId: union([
    KnownCaip19ClassicAssetStruct,
    KnownCaip19Sep41AssetStruct,
    KnownCaip19Slip44IdStruct,
  ]),
  value: nonempty(string()),
  to: optional(StellarAddressStruct),
});

const OnAmountInputParamsStruct = assign(
  OnAmountInputParamsWireStruct,
  object({
    scope: KnownCaip2ChainIdStruct,
  }),
);

const OnAmountInputJsonRpcRequestCoercedStruct = coerce(
  assign(
    JsonRpcRequestStruct,
    object({
      method: literal(ClientRequestMethod.OnAmountInput),
      params: OnAmountInputParamsStruct,
    }),
  ),
  assign(
    JsonRpcRequestStruct,
    object({
      method: literal(ClientRequestMethod.OnAmountInput),
      params: OnAmountInputParamsWireStruct,
    }),
  ),
  (request) => ({
    ...request,
    params: {
      ...request.params,
      scope: parseCaipAssetType(request.params.assetId).chainId,
    },
  }),
);

/**
 * Validation struct for the onAmountInput JSON-RPC request.
 * Derives `scope` from `assetId` (clients do not send scope).
 */
export const OnAmountInputJsonRpcRequestStruct = refine(
  OnAmountInputJsonRpcRequestCoercedStruct,
  'on-amount-input-request',
  ({ params }) => {
    if (
      (isSep41Id(params.assetId) && ValidAmountStruct.is(params.value)) ||
      (!isSep41Id(params.assetId) && ValidStellarAmountStruct.is(params.value))
    ) {
      return true;
    }
    return 'Invalid amount';
  },
);

/**
 * Validation struct for the onAmountInput JSON-RPC response.
 */
export const OnAmountInputJsonRpcResponseStruct = object({
  valid: boolean(),
  errors: array(
    object({
      code: string(),
    }),
  ),
});

const ConfirmSendParamsStruct = object({
  fromAccountId: UuidStruct,
  toAddress: StellarAddressStruct,
  assetId: union([
    KnownCaip19ClassicAssetStruct,
    KnownCaip19Sep41AssetStruct,
    KnownCaip19Slip44IdStruct,
  ]),
  amount: nonempty(string()),
});

/**
 * Validation struct for the confirmSend JSON-RPC request.
 * Coerces `fromAccountId` to `accountId` and derives `scope` from `assetId` (clients do not send scope).
 */
export const ConfirmSendJsonRpcRequestCoercedStruct = coerce(
  assign(
    JsonRpcRequestStruct,
    object({
      method: literal(ClientRequestMethod.ConfirmSend),
      params: assign(
        ConfirmSendParamsStruct,
        object({
          accountId: UuidStruct,
          scope: KnownCaip2ChainIdStruct,
        }),
      ),
    }),
  ),
  assign(
    JsonRpcRequestStruct,
    object({
      method: literal(ClientRequestMethod.ConfirmSend),
      params: ConfirmSendParamsStruct,
    }),
  ),
  (request) => ({
    ...request,
    params: {
      ...request.params,
      accountId: request.params.fromAccountId,
      scope: parseCaipAssetType(request.params.assetId).chainId,
    },
  }),
);

export const ConfirmSendJsonRpcRequestStruct = refine(
  ConfirmSendJsonRpcRequestCoercedStruct,
  'confirm-send-request',
  ({ params }) => {
    if (
      (isSep41Id(params.assetId) && ValidAmountStruct.is(params.amount)) ||
      (!isSep41Id(params.assetId) && ValidStellarAmountStruct.is(params.amount))
    ) {
      return true;
    }
    return 'Invalid amount';
  },
);

/**
 * Validation struct for the confirmSend JSON-RPC response.
 */
export const ConfirmSendJsonRpcResponseStruct = object({
  valid: optional(boolean()),
  errors: optional(
    array(
      object({
        code: string(),
      }),
    ),
  ),
  transactionId: optional(StellarTransactionHashStruct),
});

/**
 * Validation struct for the computeFee JSON-RPC request.
 */
export const ComputeFeeJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(ClientRequestMethod.ComputeFee),
    params: object({
      transaction: SwapTransactionXdrStruct,
      accountId: UuidStruct,
      scope: KnownCaip2ChainIdStruct,
      options: object({
        visible: optional(boolean()),
        type: string(),
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
 * Type for the onAddressInput JSON-RPC request.
 */
export type OnAddressInputJsonRpcRequest = Infer<
  typeof OnAddressInputJsonRpcRequestStruct
>;

/**
 * Type for the onAddressInput JSON-RPC response.
 */
export type OnAddressInputJsonRpcResponse = Infer<
  typeof OnAddressInputJsonRpcResponseStruct
>;

/**
 * Type for the onAmountInput JSON-RPC request.
 */
export type OnAmountInputJsonRpcRequest = Infer<
  typeof OnAmountInputJsonRpcRequestStruct
>;

/**
 * Type for the onAmountInput JSON-RPC response.
 */
export type OnAmountInputJsonRpcResponse = Infer<
  typeof OnAmountInputJsonRpcResponseStruct
>;

/**
 * Type for the confirmSend JSON-RPC request.
 */
export type ConfirmSendJsonRpcRequest = Infer<
  typeof ConfirmSendJsonRpcRequestStruct
>;

/**
 * Type for the confirmSend JSON-RPC response.
 */
export type ConfirmSendJsonRpcResponse = Infer<
  typeof ConfirmSendJsonRpcResponseStruct
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
