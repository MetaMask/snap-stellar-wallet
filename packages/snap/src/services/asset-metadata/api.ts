import type { AssetMetadata, FungibleAssetMetadata } from '@metamask/snaps-sdk';
import type { NonEmptyArray } from '@metamask/utils';

import type {
  AssetType,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';

export type AssetUnit = {
  decimals: number;
  symbol: string;
  name?: string | undefined;
};

export type StellarAssetMetadata = FungibleAssetMetadata & {
  assetId: KnownCaip19AssetIdOrSlip44Id;
  assetType: AssetType;
  chainId: KnownCaip2ChainId;
  units: NonEmptyArray<AssetUnit>;
  symbol: string;
  persistedAt?: number;
};

/** Sparse map persisted under state `assets` (not every id is present). */
export type AssetMetadataByAssetId = Partial<
  Record<KnownCaip19AssetIdOrSlip44Id, StellarAssetMetadata>
>;

/** A map of asset IDs to Keyring asset metadata. */
export type KeyringAssetMetadataByAssetId = Record<
  KnownCaip19AssetIdOrSlip44Id,
  AssetMetadata | null
>;

export type AssetMetadataState = {
  assets: AssetMetadataByAssetId;
};
