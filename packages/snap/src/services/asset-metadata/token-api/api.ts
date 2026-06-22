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
  type,
} from '@metamask/superstruct';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
  UrlStruct,
} from '../../../api';

// The token metadata schema for the Token API.
// Using type instead of object to avoid error throw if addtional fields are added to the response.
export const TokenMetadataStruct = type({
  decimals: integer(),
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

export const TokenMetadataByChainIdResponseStruct = object({
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
  typeof TokenMetadataByChainIdResponseStruct
>;

export type TokenMetadata = Infer<typeof TokenMetadataStruct>;
