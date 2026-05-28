import type { Infer } from '@metamask/superstruct';
import { boolean, object, optional, string, type } from '@metamask/superstruct';

/**
 * Optional per-asset fields for chains that use trust lines (Stellar classic).
 */
export const AccountAssetInfoExtraStruct = object({
  limit: optional(string()),
  authorized: optional(boolean()),
  sponsored: optional(boolean()),
});

export type AccountAssetInfoExtra = Infer<typeof AccountAssetInfoExtraStruct>;

export const AccountAssetInfoEntryStruct = object({
  metadata: type({}),
  extra: optional(AccountAssetInfoExtraStruct),
});
