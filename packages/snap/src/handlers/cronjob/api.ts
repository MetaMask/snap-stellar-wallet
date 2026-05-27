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
  KnownCaip19ClassicAssetStruct,
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

export const TrackTransactionTrustlineActionStruct = enums(['add', 'delete']);

export const TrackTransactionTrustlineVerificationStruct = object({
  assetId: KnownCaip19ClassicAssetStruct,
  action: TrackTransactionTrustlineActionStruct,
});

export const TrackTransactionParamsStruct = type({
  txId: nonempty(string()),
  scope: KnownCaip2ChainIdStruct,
  accountIds: nonempty(array(UuidStruct)),
  /** Reschedule counter; omitted on first schedule (treated as 0). */
  attempt: optional(size(integer(), 0, 30)),
  /**
   * When set, {@link TrackTransactionHandler} syncs until a fresh Horizon load matches this
   * trustline outcome before marking the keyring transaction Confirmed.
   */
  trustlineVerification: optional(TrackTransactionTrustlineVerificationStruct),
});

export const SyncAccountParamsStruct = object({
  /** Omitted or undefined means “selected accounts” (declarative cron may send `{}`). */
  accountIds: optional(
    union([nonempty(array(UuidStruct)), literal('selected')]),
  ),
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

export type SyncAccountJsonRpcRequest = Infer<
  typeof SyncAccountJsonRpcRequestStruct
>;

export type SyncAccountParams = Infer<typeof SyncAccountParamsStruct>;
