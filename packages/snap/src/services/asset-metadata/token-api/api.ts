import type { Infer } from '@metamask/superstruct';
import {
  array,
  integer,
  object,
  optional,
  string,
  union,
  nonempty,
  number,
} from '@metamask/superstruct';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
  UrlStruct,
} from '../../../api';

export const TokenMetadataStruct = object({
  decimals: integer(),
  // there should be no slip44 assets in the token metadata response
  assetId: union([
    KnownCaip19ClassicAssetStruct,
    KnownCaip19Sep41AssetStruct,
    KnownCaip19Slip44IdStruct,
  ]),
  name: optional(nonempty(string())),
  symbol: optional(nonempty(string())),
  iconUrl: optional(UrlStruct),
});

export const TokenMetadataByAssetIdsResponseStruct = array(TokenMetadataStruct);

export const TokenMetadatabyChainIdResponseStruct = object({
  data: array(TokenMetadataStruct),
  count: number(),
  totalCount: number(),
  // Accept any fields from the pageInfo object, as we don't use them yet
  pageInfo: optional(object()),
});

export type TokenMetadataByAssetIdsResponse = Infer<
  typeof TokenMetadataByAssetIdsResponseStruct
>;
export type TokenMetadataByChainIdResponse = Infer<
  typeof TokenMetadatabyChainIdResponseStruct
>;

export type TokenMetadata = Infer<typeof TokenMetadataStruct>;
