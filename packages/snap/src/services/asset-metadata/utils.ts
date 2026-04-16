import { parseCaipAssetType } from '@metamask/utils';

import type { StellarAssetMetadata } from './api';
import type {
  AssetType,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
  KnownCaip19AssetIdOrSlip44Id,
} from '../../api';
import { AppConfig } from '../../config';
import {
  NATIVE_ASSET_NAME,
  NATIVE_ASSET_SYMBOL,
  STELLAR_DECIMAL_PLACES,
} from '../../constants';
import { buildUrl } from '../../utils';

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
 * Builds {@link StellarAssetMetadata} for the native XLM slip44 id on the given network.
 *
 * @param assetId - Slip44 CAIP-19 id for native lumens on a Stellar scope.
 * @returns Metadata with standard name, symbol, and 7 decimals.
 */
export function getNativeAssetMetadata(
  assetId: KnownCaip19Slip44Id,
): StellarAssetMetadata {
  return toStellarAssetMetadata({
    assetId,
    decimals: STELLAR_DECIMAL_PLACES,
    symbol: NATIVE_ASSET_SYMBOL,
    name: NATIVE_ASSET_NAME,
  });
}
