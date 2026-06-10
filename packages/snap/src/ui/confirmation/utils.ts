import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import type { CaipAccountId } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import { FetchStatus, type FeeData } from './api';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { getNativeAssetMetadata } from '../../services/asset-metadata/utils';
import { parseOperationAssetReference } from '../../services/transaction/utils';
import {
  type TokenScanResult,
  TransactionScanValidationType,
  type TransactionScanResult,
} from '../../services/transaction-scan';
import type { Locale } from '../../utils';
import {
  FALLBACK_LANGUAGE,
  getPreferences,
  parseClassicAssetCodeIssuer,
  toDisplayBalance,
} from '../../utils';
import { xlmIcon } from '../images';

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
 * Gets the account explorer url for a given account address.
 *
 * @param address - The account address.
 * @returns The account explorer url.
 */
export function getAccountExplorerUrl(address: string): string {
  return `${
    AppConfig.networks[AppConfig.selectedNetwork].explorerBaseUrl
  }/account/${address}`;
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
  const amountInLumen = toDisplayBalance(new BigNumber(amountInStroops));
  return {
    assetId: nativeAssetMetadata.assetId,
    symbol: nativeAssetMetadata.symbol,
    iconUrl: nativeAssetMetadata.iconUrl,
    amount: amountInLumen,
  };
}

/**
 * Determines whether a transaction confirmation must be temporarily blocked by scan state.
 *
 * @param params - Scan and preference state.
 * @param params.preferences - User preferences controlling scan behavior.
 * @param params.scan - Latest transaction scan result.
 * @param params.scanFetchStatus - Latest transaction scan fetch status.
 * @returns True when the confirm action should be disabled.
 */
export function isConfirmDisabledByScan(params: {
  preferences: GetPreferencesResult;
  scan?: TransactionScanResult | null;
  scanFetchStatus: FetchStatus;
}): boolean {
  const { preferences, scan, scanFetchStatus } = params;
  return (
    scanFetchStatus === FetchStatus.Fetching ||
    (preferences.useSecurityAlerts &&
      scan?.validation?.type === TransactionScanValidationType.Malicious)
  );
}

/**
 * Determines whether a change-trust confirmation must be blocked by token scan state.
 *
 * @param params - Token scan and preference state.
 * @param params.preferences - User preferences controlling security alerts.
 * @param params.tokenScan - Latest token scan result.
 * @param params.tokenScanFetchStatus - Latest token scan fetch status.
 * @returns True when the confirm action should be disabled.
 */
export function isConfirmDisabledByTokenScan(params: {
  preferences: GetPreferencesResult;
  tokenScan?: TokenScanResult | null;
  tokenScanFetchStatus: FetchStatus;
}): boolean {
  const { preferences, tokenScan, tokenScanFetchStatus } = params;
  // Token-scan/API errors fail open by design, matching the Tron snap.
  // Unlike transaction validation, a scan Error must not block legitimate
  // trustline ops.
  return (
    preferences.useSecurityAlerts &&
    (tokenScanFetchStatus === FetchStatus.Fetching ||
      tokenScan?.isMalicious === true ||
      tokenScan?.isWarning === true)
  );
}

/**
 * Determines whether the token scan alert would render.
 *
 * @param params - Token scan and preference state.
 * @param params.preferences - User preferences controlling security alerts.
 * @param params.tokenScan - Latest token scan result.
 * @param params.tokenScanFetchStatus - Latest token scan fetch status.
 * @returns True when the token scan banner should be visible.
 */
export function hasVisibleTokenScanAlert(params: {
  preferences: GetPreferencesResult;
  tokenScan?: TokenScanResult | null;
  tokenScanFetchStatus: FetchStatus;
}): boolean {
  const { preferences, tokenScan, tokenScanFetchStatus } = params;
  return (
    preferences.useSecurityAlerts &&
    (tokenScanFetchStatus === FetchStatus.Fetching ||
      (tokenScanFetchStatus === FetchStatus.Fetched &&
        (tokenScan?.isMalicious === true || tokenScan?.isWarning === true)))
  );
}

/**
 * Determines whether the transaction scan alert would render.
 *
 * @param params - Scan and preference state.
 * @param params.preferences - User preferences controlling scan behavior.
 * @param params.scan - Latest transaction scan result.
 * @param params.scanFetchStatus - Latest transaction scan fetch status.
 * @returns True when the transaction scan banner should take priority.
 */
export function hasVisibleTransactionAlert(params: {
  preferences: GetPreferencesResult;
  scan?: TransactionScanResult | null;
  scanFetchStatus: FetchStatus;
}): boolean {
  const { preferences, scan, scanFetchStatus } = params;

  if (
    scanFetchStatus === FetchStatus.Fetching ||
    scanFetchStatus === FetchStatus.Error
  ) {
    return true;
  }

  if (scan?.error) {
    if (scan.error.type === 'simulation') {
      return preferences.simulateOnChainActions;
    }

    if (scan.error.type === 'validation') {
      return preferences.useSecurityAlerts;
    }

    return hasEnabledTransactionScan(preferences);
  }

  return (
    preferences.useSecurityAlerts &&
    (scan?.validation?.type === TransactionScanValidationType.Malicious ||
      scan?.validation?.type === TransactionScanValidationType.Warning)
  );
}

export enum ConfirmationBanner {
  None = 'none',
  ValidationError = 'validationError',
  TransactionScan = 'transactionScan',
  TokenScan = 'tokenScan',
}

/**
 * Resolves the single confirmation banner to render. Banners are mutually
 * exclusive and use this priority: transaction validation error, transaction
 * scan alert, then token scan alert.
 *
 * @param params - Confirmation banner source state.
 * @param params.preferences - User preferences controlling scan behavior.
 * @param params.transactionsFetchStatus - Latest transaction validation fetch status.
 * @param params.scan - Latest transaction scan result.
 * @param params.scanFetchStatus - Latest transaction scan fetch status.
 * @param params.tokenScan - Latest token scan result.
 * @param params.tokenScanFetchStatus - Latest token scan fetch status.
 * @returns The highest-priority banner to render.
 */
export function resolveConfirmationBanner(params: {
  preferences: GetPreferencesResult;
  transactionsFetchStatus: FetchStatus;
  scan?: TransactionScanResult | null;
  scanFetchStatus: FetchStatus;
  tokenScan?: TokenScanResult | null;
  tokenScanFetchStatus?: FetchStatus;
}): ConfirmationBanner {
  const {
    preferences,
    transactionsFetchStatus,
    scan,
    scanFetchStatus,
    tokenScan,
    tokenScanFetchStatus,
  } = params;

  if (transactionsFetchStatus === FetchStatus.Error) {
    return ConfirmationBanner.ValidationError;
  }

  if (
    hasEnabledTransactionScan(preferences) &&
    hasVisibleTransactionAlert({ preferences, scan, scanFetchStatus })
  ) {
    return ConfirmationBanner.TransactionScan;
  }

  if (
    tokenScanFetchStatus !== undefined &&
    hasVisibleTokenScanAlert({
      preferences,
      tokenScan,
      tokenScanFetchStatus,
    })
  ) {
    return ConfirmationBanner.TokenScan;
  }

  return ConfirmationBanner.None;
}

/**
 * Determines whether transaction scan UI should be shown for the current preferences.
 *
 * @param preferences - User preferences controlling scan behavior.
 * @returns True when either security validation alerts or simulation alerts are enabled.
 */
export function hasEnabledTransactionScan(
  preferences: GetPreferencesResult,
): boolean {
  return preferences.useSecurityAlerts || preferences.simulateOnChainActions;
}

/**
 * Determines whether the confirm action must be blocked because background
 * re-validation found the pending transaction is no longer valid.
 *
 * @param transactionsFetchStatus - Latest transaction validation fetch status.
 * @returns True when the confirm action should be disabled.
 */
export function isConfirmDisabledByTransactionValidation(
  transactionsFetchStatus: FetchStatus | undefined,
): boolean {
  return transactionsFetchStatus === FetchStatus.Error;
}

/**
 * Display-friendly resolution of a Stellar operation `asset` reference.
 * Used by the confirmation UI to render assets and to look up prices.
 */
export type ResolvedAssetDisplay = {
  /** CAIP-19 id used to key into the prices map. */
  assetId: KnownCaip19AssetIdOrSlip44Id;
  /** Short ticker (e.g. `XLM`, `USD`). */
  symbol: string;
  /** Bundled icon when known (native XLM only today). */
  iconUrl?: string;
  /** Explorer link for classic assets. */
  link?: string;
};

/**
 * Resolves an `OperationMapper` asset reference into the data required to display it.
 *
 * @param scope - CAIP-2 chain of the transaction.
 * @param assetReference - Either `'native'` or a classic `CODE-ISSUER` / `CODE:ISSUER` string.
 * @returns The resolved display data, or `null` when the reference cannot be parsed
 * (e.g. liquidity pool ids that arrive on `setTrustLineFlags` / `revokeSponsorship`).
 */
export function resolveAssetDisplay(
  scope: KnownCaip2ChainId,
  assetReference: string,
): ResolvedAssetDisplay | null {
  const assetId = parseOperationAssetReference(scope, assetReference);
  if (assetId === null) {
    return null;
  }
  if (assetReference === 'native') {
    const native = getNativeAssetMetadata(scope);
    return {
      assetId,
      symbol: native.symbol,
      // Use the bundled SVG instead of the remote token-icon URL
      iconUrl: xlmIcon,
    };
  }
  // Safe: parseOperationAssetReference returned non-null for a non-native ref,
  // so the reference is a parseable classic CODE-ISSUER pair.
  const { assetCode } = parseClassicAssetCodeIssuer(assetReference);
  // TODO: resolve classic-asset iconUrl via AssetMetadataService once
  // integrated, instead of letting <AssetIcon> fall back to question-mark.
  return {
    assetId,
    symbol: assetCode,
    link: getClassicAssetExplorerUrl(assetReference),
  };
}
