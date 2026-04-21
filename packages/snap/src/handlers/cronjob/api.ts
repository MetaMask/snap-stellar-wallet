import type { Infer } from '@metamask/superstruct';
import {
  array,
  assign,
  boolean,
  enums,
  literal,
  nonempty,
  object,
  string,
  type,
} from '@metamask/superstruct';
import type { Json, JsonRpcRequest } from '@metamask/utils';

import {
  JsonRpcRequestStruct,
  KnownCaip2ChainIdStruct,
  UuidStruct,
} from '../../api';
import { ConfirmationInterfaceKeyStruct } from '../../ui/confirmation/api';

/**
 * Interface for the client request handler.
 */
export type ICronjobRequestHandler = {
  handle: (request: JsonRpcRequest) => Promise<Json>;
};

export enum CronjobMethod {
  SynchronizeAssets = 'synchronizeAssets',
}

export enum BackgroundEventMethod {
  RefreshConfirmationPrices = 'refreshConfirmationPrices',
  TrackTransaction = 'trackTransaction',
}

export const BackgroundEventMethodStruct = enums(
  Object.values(BackgroundEventMethod),
);

export const RefreshConfirmationPricesParamsStruct = type({
  scope: KnownCaip2ChainIdStruct,
  interfaceId: nonempty(string()),
  interfaceKey: ConfirmationInterfaceKeyStruct,
});

export const TrackTransactionParamsStruct = type({
  txId: nonempty(string()),
  scope: KnownCaip2ChainIdStruct,
  accountIds: nonempty(array(UuidStruct)),
});

export const RefreshConfirmationPricesJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(BackgroundEventMethod.RefreshConfirmationPrices),
    params: RefreshConfirmationPricesParamsStruct,
  }),
);

export const TrackTransactionJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(BackgroundEventMethod.TrackTransaction),
    params: TrackTransactionParamsStruct,
  }),
);

export const CrobJobJsonRpcRequestStruct = object({
  status: boolean(),
});

export type CrobJobJsonRpcRequest = Infer<typeof CrobJobJsonRpcRequestStruct>;

export type RefreshConfirmationPricesJsonRpcRequest = Infer<
  typeof RefreshConfirmationPricesJsonRpcRequestStruct
>;

export type RefreshConfirmationPricesParams = Infer<
  typeof RefreshConfirmationPricesParamsStruct
>;

export type TrackTransactionJsonRpcRequest = Infer<
  typeof TrackTransactionJsonRpcRequestStruct
>;

export type TrackTransactionParams = Infer<typeof TrackTransactionParamsStruct>;
