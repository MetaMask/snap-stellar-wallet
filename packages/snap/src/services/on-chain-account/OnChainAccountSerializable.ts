import type { Infer } from '@metamask/superstruct';
import {
  array,
  assign,
  boolean,
  number,
  object,
  optional,
  string,
  union,
} from '@metamask/superstruct';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
  KnownCaip2ChainIdStruct,
} from '../../api';

/** Header-only binding: RPC-style account (id + sequence + network), no balances or ledger meta. */
export const OnChainAccountMinimalSerializableStruct = object({
  accountId: string(),
  sequenceNumber: string(),
  scope: KnownCaip2ChainIdStruct,
});

export type OnChainAccountMinimalSerializable = Infer<
  typeof OnChainAccountMinimalSerializableStruct
>;

export const SerializableClassicSpendableBalanceStruct = object({
  assetId: KnownCaip19ClassicAssetStruct,
  balance: string(),
  symbol: string(),
  limit: string(),
  address: string(),
  authorized: boolean(),
  sponsored: optional(boolean()),
});

export type SerializableClassicSpendableBalance = Infer<
  typeof SerializableClassicSpendableBalanceStruct
>;

export const SerializableSep41SpendableBalanceStruct = object({
  assetId: KnownCaip19Sep41AssetStruct,
  balance: string(),
  symbol: string(),
});

export type SerializableSep41SpendableBalance = Infer<
  typeof SerializableSep41SpendableBalanceStruct
>;

export const SerializableSlip44SpendableBalanceStruct = object({
  assetId: KnownCaip19Slip44IdStruct,
  balance: string(),
  symbol: string(),
});

export type SerializableSlip44SpendableBalance = Infer<
  typeof SerializableSlip44SpendableBalanceStruct
>;

/**
 * JSON-safe balance rows: numeric fields are decimal strings (stroops). Callers that produce this
 * shape (Horizon sync, persisted snap) are expected to supply valid numeric strings; stricter
 * superstruct refinements can be added later if needed.
 */
export const SerializableSpendableBalanceStruct = union([
  SerializableClassicSpendableBalanceStruct,
  SerializableSep41SpendableBalanceStruct,
  SerializableSlip44SpendableBalanceStruct,
]);
export type SerializableSpendableBalance = Infer<
  typeof SerializableSpendableBalanceStruct
>;

/**
 * Full binding: ledger meta, all balance rows, and on-ledger native total as a stroops integer string.
 * Native slip44 spendable is always recomputed on bind from `rawNativeBalance` + meta via
 * `calculateSpendableBalance` (same as Horizon).
 */
export const OnChainAccountSerializableFullStruct = assign(
  OnChainAccountMinimalSerializableStruct,
  object({
    meta: object({
      subentryCount: number(),
      numSponsoring: number(),
      numSponsored: number(),
    }),
    balances: array(SerializableSpendableBalanceStruct),
    rawNativeBalance: string(),
  }),
);

export type OnChainAccountSerializableFull = Infer<
  typeof OnChainAccountSerializableFullStruct
>;

/** Minimal header or validated full snapshot; partial shapes are rejected at bind time. */
export type OnChainAccountSerializable =
  | OnChainAccountMinimalSerializable
  | OnChainAccountSerializableFull;
