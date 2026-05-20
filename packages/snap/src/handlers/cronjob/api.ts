import type { Infer } from '@metamask/superstruct';
import {
  array,
  assign,
  boolean,
  enums,
  integer,
  literal,
  nonempty,
  object,
  optional,
  size,
  string,
  type,
  union,
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

export enum BackgroundEventMethod {
  SynchronizeAccounts = 'synchronizeAccounts',
  RefreshConfirmationContext = 'refreshConfirmationContext',
  TrackTransaction = 'trackTransaction',
}

export const BackgroundEventMethodStruct = enums(
  Object.values(BackgroundEventMethod),
);

export const RefreshConfirmationContextParamsStruct = type({
  scope: KnownCaip2ChainIdStruct,
  interfaceId: nonempty(string()),
  interfaceKey: ConfirmationInterfaceKeyStruct,
});

export const TrackTransactionParamsStruct = type({
  txId: nonempty(string()),
  scope: KnownCaip2ChainIdStruct,
  accountIds: nonempty(array(UuidStruct)),
  /** Reschedule counter; omitted on first schedule (treated as 0). */
  attempt: optional(size(integer(), 0, 30)),
});

export const SyncAccountParamsStruct = object({
  /** Omitted or undefined means “selected accounts” (declarative cron may send `{}`). */
  accountIds: optional(
    union([nonempty(array(UuidStruct)), literal('selected')]),
  ),
});

export const RefreshConfirmationContextJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(BackgroundEventMethod.RefreshConfirmationContext),
    params: RefreshConfirmationContextParamsStruct,
  }),
);

export const TrackTransactionJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(BackgroundEventMethod.TrackTransaction),
    params: TrackTransactionParamsStruct,
  }),
);

export const SyncAccountJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: literal(BackgroundEventMethod.SynchronizeAccounts),
    // Omitted in declarative manifest cron jobs (matches Bitcoin wallet snap);
    // runtime defaults to synchronizing selected accounts.
    params: optional(SyncAccountParamsStruct),
  }),
);

export const CronjobJsonRpcRequestStruct = object({
  status: boolean(),
});

export type CronjobJsonRpcRequest = Infer<typeof CronjobJsonRpcRequestStruct>;

export type RefreshConfirmationContextJsonRpcRequest = Infer<
  typeof RefreshConfirmationContextJsonRpcRequestStruct
>;

export type RefreshConfirmationContextParams = Infer<
  typeof RefreshConfirmationContextParamsStruct
>;

export type TrackTransactionJsonRpcRequest = Infer<
  typeof TrackTransactionJsonRpcRequestStruct
>;

export type TrackTransactionParams = Infer<typeof TrackTransactionParamsStruct>;

export type SyncAccountJsonRpcRequest = Infer<
  typeof SyncAccountJsonRpcRequestStruct
>;

export type SyncAccountParams = Infer<typeof SyncAccountParamsStruct>;
