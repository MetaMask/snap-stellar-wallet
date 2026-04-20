import type { AssetMetadata } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { parseCaipAssetType } from '@metamask/utils';

import type { StellarAssetMetadata } from './api';
import type {
  AssetType,
  KnownCaip2ChainId,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19Slip44Id,
  KnownCaip19AssetId,
} from '../../api';
import { KnownCaip2ChainIdStruct } from '../../api';
import { AppConfig } from '../../config';
import {
  NATIVE_ASSET_NAME,
  NATIVE_ASSET_SYMBOL,
  STELLAR_DECIMAL_PLACES,
} from '../../constants';
import { buildUrl, getSlip44AssetId, isSlip44Id } from '../../utils';

/**
 * Returns the icon URL for a given asset ID.
 *
 * @param assetId - The asset ID.
 * @returns The icon URL.
 */
export function getIconUrl(assetId: KnownCaip19AssetIdOrSlip44Id): string {
  return buildUrl({
    baseUrl: AppConfig.api.staticApi.baseUrl,
    path: '/api/v2/tokenIcons/assets/{assetId}.png',
    pathParams: {
      assetId: assetId.replace(/:/gu, '/'),
    },
    encodePathParams: false,
  });
}

/**
 * Maps token API fields into {@link StellarAssetMetadata} for confirmations and UI.
 *
 * @param assetData - Raw asset row from the token API or equivalent.
 * @param assetData.assetId - CAIP-19 asset id (classic, slip44, or sep41).
 * @param assetData.decimals - Smallest-unit decimal count for the primary unit.
 * @param assetData.symbol - Ticker or short symbol for display.
 * @param assetData.name - Optional long name; defaults to `symbol` when omitted.
 * @returns Keyring-shaped metadata including icon URL and units.
 */
export function toStellarAssetMetadata(assetData: {
  assetId: KnownCaip19AssetIdOrSlip44Id;
  decimals: number;
  symbol: string;
  name?: string;
}): StellarAssetMetadata {
  const name = assetData.name ?? assetData.symbol;
  const { assetNamespace, chainId } = parseCaipAssetType(assetData.assetId);

  return {
    assetId: assetData.assetId,
    name,
    symbol: assetData.symbol,
    chainId: chainId as KnownCaip2ChainId,
    assetType: assetNamespace as AssetType,
    fungible: true,
    iconUrl: getIconUrl(assetData.assetId),
    units: [
      {
        name,
        symbol: assetData.symbol,
        decimals: assetData.decimals,
      },
    ],
  };
}

/**
 * Maps {@link StellarAssetMetadata} to {@link AssetMetadata}.
 *
 * @param assetData - The Stellar asset metadata.
 * @returns The Keyring asset metadata.
 */
export function toKeyringAssetMetadata(
  assetData: StellarAssetMetadata,
): AssetMetadata {
  return {
    fungible: assetData.fungible,
    iconUrl: assetData.iconUrl,
    units: assetData.units,
    symbol: assetData.symbol,
    name: assetData.name,
  };
}

/**
 * Builds {@link StellarAssetMetadata} for the native XLM slip44 id on the given network.
 *
 * @param scope - The CAIP-2 chain id.
 * @returns Metadata with standard name, symbol, and 7 decimals.
 */
export function getNativeAssetMetadata(
  scope: KnownCaip2ChainId,
): StellarAssetMetadata {
  return toStellarAssetMetadata({
    assetId: getSlip44AssetId(scope),
    decimals: STELLAR_DECIMAL_PLACES,
    symbol: NATIVE_ASSET_SYMBOL,
    name: NATIVE_ASSET_NAME,
  });
}

/**
 * Groups asset IDs by chain ID and separates native assets from non-native assets.
 * This function also deduplicates asset ids.
 *
 * @param assetIds - The asset IDs to group.
 * @returns An object with two maps of chain IDs to asset IDs: one for native assets and one for non-native assets.
 */
export function groupAssetsByChainId(
  assetIds: KnownCaip19AssetIdOrSlip44Id[],
): {
  nativeAssets: Map<KnownCaip2ChainId, KnownCaip19Slip44Id[]>;
  assets: Map<KnownCaip2ChainId, KnownCaip19AssetId[]>;
} {
  const assets = new Map<KnownCaip2ChainId, KnownCaip19AssetId[]>();

  const nativeAssets = new Map<KnownCaip2ChainId, KnownCaip19Slip44Id[]>();

  const uniqueAssetIds = new Set<KnownCaip19AssetIdOrSlip44Id>();

  // group assets by chain id
  for (const assetId of assetIds) {
    // deduplicate asset ids
    if (uniqueAssetIds.has(assetId)) {
      continue;
    }
    uniqueAssetIds.add(assetId);

    const { chainId } = parseCaipAssetType(assetId);

    assert(chainId, KnownCaip2ChainIdStruct);

    if (isSlip44Id(assetId)) {
      if (!nativeAssets.has(chainId)) {
        nativeAssets.set(chainId, []);
      }
      nativeAssets.get(chainId)?.push(assetId);
    } else {
      if (!assets.has(chainId)) {
        assets.set(chainId, []);
      }
      assets.get(chainId)?.push(assetId);
    }
  }
  return {
    nativeAssets,
    assets,
  };
}
