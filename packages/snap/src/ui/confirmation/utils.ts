import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import type { CaipAccountId } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import type { FeeData } from './api';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { getNativeAssetMetadata } from '../../services/asset-metadata/utils';
import type { Locale } from '../../utils';
import {
  FALLBACK_LANGUAGE,
  getPreferences,
  normalizeAmount,
} from '../../utils';

const NetworkName = {
  [KnownCaip2ChainId.Mainnet]: 'Mainnet',
  [KnownCaip2ChainId.Testnet]: 'Testnet',
};

/**
 * Converts a CAIP-2 chain id to a network name string.
 *
 * @param scope - The CAIP-2 chain id.
 * @returns The network name string.
 */
export function getNetworkName(scope: KnownCaip2ChainId): string {
  return NetworkName[scope] ?? 'Unknown';
}

/**
 * Formats an origin for display purposes.
 *
 * @param origin - The origin string to format (e.g., 'metamask', 'https://example.com').
 * @returns The formatted origin string (e.g., 'MetaMask', 'example.com').
 */
export function formatOrigin(origin: string | undefined): string {
  if (!origin) {
    return 'Unknown';
  }

  // Special case: format 'metamask' as 'MetaMask' (case-insensitive)
  if (origin.toLowerCase() === 'metamask') {
    return 'MetaMask';
  }

  // Try to extract hostname from URL
  try {
    return new URL(origin).hostname;
  } catch {
    // If not a valid URL, return the original value
    // This shouldn't happen if validation is working correctly
    return origin;
  }
}

/**
 * Gets the locale from the preferences.
 *
 * @returns The locale.
 */
export async function getLocale(): Promise<Locale> {
  return (
    ((await getPreferences()
      .then((preferences) => preferences.locale)
      .catch(() => FALLBACK_LANGUAGE)) as Locale) ?? FALLBACK_LANGUAGE
  );
}

/**
 * Gets the preferences with fallback.
 *
 * @returns The preferences with fallback.
 */
export async function getPreferencesWithFallback(): Promise<GetPreferencesResult> {
  return getPreferences().catch(() => ({
    locale: FALLBACK_LANGUAGE,
    currency: 'usd',
    hideBalances: false,
    useSecurityAlerts: true,
    simulateOnChainActions: true,
    useTokenDetection: true,
    batchCheckBalances: true,
    displayNftMedia: true,
    useNftDetection: true,
    useExternalPricingData: true,
    showTestnets: true,
  }));
}

/**
 * Gets the classic asset explorer url for a given asset reference.
 *
 * @param assetReference - The asset reference.
 * @returns The classic asset explorer url.
 */
export function getClassicAssetExplorerUrl(assetReference: string): string {
  return `${
    AppConfig.networks[AppConfig.selectedNetwork].explorerBaseUrl
  }/asset/${assetReference}`;
}

/**
 * Gets the SEP-41 asset explorer url for a given asset reference.
 *
 * @param assetReference - The asset reference.
 * @returns The SEP-41 asset explorer url.
 */
export function getSepAssetExplorerUrl(assetReference: string): string {
  return `${
    AppConfig.networks[AppConfig.selectedNetwork].explorerBaseUrl
  }/contract/${assetReference}`;
}

/**
 * Gets the account name for a given CAIP-2 chain id and address.
 *
 * @param scope - The CAIP-2 chain id.
 * @param address - The account address.
 * @returns The account name.
 */
export function getAccountName(
  scope: KnownCaip2ChainId,
  address: string,
): CaipAccountId {
  return `${scope}:${address}`;
}

/**
 * Formats the fee data for a given CAIP-2 chain id and amount in stroops.
 * It converts the amount in stroops to the native asset amount and returns the fee data.
 *
 * @param scope - The CAIP-2 chain id.
 * @param amountInStroops - The amount in stroops.
 * @returns The fee data that can be used to display the fee in the UI.
 */
export function formatFeeData(
  scope: KnownCaip2ChainId,
  amountInStroops: string,
): FeeData {
  const nativeAssetMetadata = getNativeAssetMetadata(scope);
  const amountInLumen = normalizeAmount(new BigNumber(amountInStroops));
  return {
    assetId: nativeAssetMetadata.assetId,
    symbol: nativeAssetMetadata.symbol,
    iconUrl: nativeAssetMetadata.iconUrl,
    amount: amountInLumen.toString(),
  };
}
