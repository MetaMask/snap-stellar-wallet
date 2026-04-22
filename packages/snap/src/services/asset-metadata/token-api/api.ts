import type { Infer } from '@metamask/superstruct';
import {
  array,
  integer,
  object,
  optional,
  string,
  union,
  nonempty,
} from '@metamask/superstruct';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  UrlStruct,
} from '../../../api';

export const TokenMetadataStruct = object({
  decimals: integer(),
  // there should be no slip44 assets in the token metadata response
  assetId: union([KnownCaip19ClassicAssetStruct, KnownCaip19Sep41AssetStruct]),
  name: optional(nonempty(string())),
  symbol: optional(nonempty(string())),
  iconUrl: optional(UrlStruct),
});

export const TokenMetadataResponseStruct = array(TokenMetadataStruct);

export type TokenMetadataResponse = Infer<typeof TokenMetadataResponseStruct>;

export type TokenMetadata = Infer<typeof TokenMetadataStruct>;
