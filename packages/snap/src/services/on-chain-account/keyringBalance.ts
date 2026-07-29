import {
  assign,
  boolean,
  defaulted,
  literal,
  object,
  string,
  union,
  optional,
  number,
} from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';

import type { SpendableBalance } from './api';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { NATIVE_ASSET_SYMBOL, STELLAR_DECIMAL_PLACES } from '../../constants';
import { toDisplayBalance } from '../../utils';

export const StandardBalanceEntryStruct = object({
  unit: string(),
  amount: string(),
});

export const NativeBalanceEntryStruct = assign(
  StandardBalanceEntryStruct,
  object({
    unit: defaulted(literal(NATIVE_ASSET_SYMBOL), NATIVE_ASSET_SYMBOL),
    metadata: optional(
      object({
        spendableBalance: string(),
        minimumReserveBalance: string(),
        decimal: number(),
      }),
    ),
  }),
);

export const ClassicBalanceEntryStruct = assign(
  StandardBalanceEntryStruct,
  object({
    metadata: optional(
      object({
        limit: string(),
        authorized: defaulted(boolean(), true),
        sponsor: defaulted(string(), ''),
      }),
    ),
  }),
);

export const KeyringBalanceEntryStruct = union([
  NativeBalanceEntryStruct,
  ClassicBalanceEntryStruct,
  StandardBalanceEntryStruct,
]);

/**
 * Keyring balance entry for a given asset.
 */
export type KeyringBalanceEntry = Infer<typeof KeyringBalanceEntryStruct>;

/**
 * Keyring balance by asset id.
 */
export type KeyringBalanceByAssetId = Record<
  KnownCaip19AssetIdOrSlip44Id,
  KeyringBalanceEntry
>;

/**
 * Keyring / sync balance payload for native XLM.
 *
 * `amount` is display units; `spendableBalance` and `minimumReserveBalance` stay in stroops.
 *
 * @param params - Native balance fields in stroops.
 * @param params.nativeBalance - Total native balance in stroops.
 * @param params.spendableBalance - Spendable native balance in stroops.
 * @param params.minimumReserveBalance - Protocol minimum reserve in stroops.
 * @returns Balance change entry for the native asset.
 */
export function toNativeBalanceEntry(params: {
  nativeBalance: BigNumber;
  spendableBalance: BigNumber;
  minimumReserveBalance: BigNumber;
}): KeyringBalanceEntry {
  return NativeBalanceEntryStruct.create({
    amount: toDisplayBalance(params.nativeBalance),
    metadata: {
      spendableBalance: params.spendableBalance.toFixed(0),
      minimumReserveBalance: params.minimumReserveBalance.toFixed(0),
      decimal: STELLAR_DECIMAL_PLACES,
    },
  });
}

/**
 * Keyring / sync balance payload for a classic trustline.
 *
 * @param asset - Classic spendable balance entry (visible or tombstone).
 * @returns Balance change entry with classic metadata.
 */
export function toClassicBalanceEntry(
  asset: SpendableBalance,
): KeyringBalanceEntry {
  return ClassicBalanceEntryStruct.create({
    unit: asset.symbol,
    amount: toDisplayBalance(asset.balance, asset.decimals),
    metadata: {
      limit: toDisplayBalance(asset.limit ?? new BigNumber(0), asset.decimals),
      authorized: asset.authorized,
      sponsor: asset.sponsor,
    },
  });
}

/**
 * Keyring / sync balance payload for SEP-41 (and other non-classic) assets.
 *
 * @param asset - Spendable balance entry.
 * @returns Balance change entry without classic/native metadata.
 */
export function toStandardBalanceEntry(
  asset: SpendableBalance,
): KeyringBalanceEntry {
  return StandardBalanceEntryStruct.create({
    unit: asset.symbol,
    amount: toDisplayBalance(asset.balance, asset.decimals),
  });
}

/**
 * Zero native balance entry for inactive / not-yet-synced accounts.
 *
 * @returns Default native balance change entry.
 */
export function getDefaultBalanceEntry(): KeyringBalanceEntry {
  return toNativeBalanceEntry({
    nativeBalance: new BigNumber(0),
    spendableBalance: new BigNumber(0),
    minimumReserveBalance: new BigNumber(0),
  });
}
