import { parseCaipAssetType } from '@metamask/utils';

import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
} from '../api';
import {
  AssetType,
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdMap,
} from '../api';

/**
 * Converts the given parameters to a CAIP-19 non native asset ID.
 *
 * @param scope - The CAIP-2 chain ID.
 * @param assetCode - The asset code.
 * @param assetIssuer - The asset issuer.
 * @returns The CAIP-19 asset ID.
 */
export function toCaip19ClassicAssetId(
  scope: KnownCaip2ChainId,
  assetCode: string,
  assetIssuer: string,
): KnownCaip19ClassicAssetId {
  return `${scope}/${AssetType.Token}:${assetCode}-${assetIssuer}`;
}

/**
 * Converts the given parameters to a CAIP-19 Sep41 asset ID.
 *
 * @param scope - The CAIP-2 chain ID.
 * @param contractAddress - The contract address.
 * @returns The CAIP-19 Sep41 asset ID.
 */
export function toCaip19Sep41AssetId(
  scope: KnownCaip2ChainId,
  contractAddress: string,
): KnownCaip19Sep41AssetId {
  return `${scope}/${AssetType.Sep41}:${contractAddress}`;
}

/**
 * Checks if the given asset ID is a slip44 ID.
 *
 * @param assetId - The CAIP-19 asset ID or slip44 ID.
 * @returns True if the asset ID is a slip44 ID, false otherwise.
 */
export function isSlip44Id(
  assetId: KnownCaip19AssetIdOrSlip44Id | string,
): assetId is KnownCaip19Slip44Id {
  return Object.values(KnownCaip19Slip44IdMap).includes(
    assetId as KnownCaip19Slip44Id,
  );
}

/**
 * Returns true if the given asset ID is a Sep41 Asset ID.
 *
 * @param assetId - The CAIP-19 Sep41 Asset ID.
 * @returns True if the asset ID is a Sep41 Asset ID, false otherwise.
 */
export function isSep41Id(
  assetId: KnownCaip19AssetIdOrSlip44Id | string,
): assetId is KnownCaip19Sep41AssetId {
  const [error] = KnownCaip19Sep41AssetStruct.validate(assetId);
  return error === undefined;
}

/**
 * Checks if the given asset ID is a classic asset ID.
 *
 * @param assetId - The CAIP-19 asset ID or slip44 ID.
 * @returns True if the asset ID is a classic asset ID, false otherwise.
 */
export function isClassicAssetId(
  assetId: KnownCaip19AssetIdOrSlip44Id | string,
): assetId is KnownCaip19ClassicAssetId {
  const [error] = KnownCaip19ClassicAssetStruct.validate(assetId);
  return error === undefined;
}

/**
 * Returns the asset reference from a CAIP-19 asset id.
 *
 * @param assetId - CAIP-19 asset id.
 * @returns Asset reference.
 */
export function getAssetReference(
  assetId: KnownCaip19AssetIdOrSlip44Id,
): string {
  const { assetReference } = parseCaipAssetType(assetId);
  return assetReference;
}

/**
 * Returns the slip44 asset ID for the given scope.
 *
 * @param scope - The CAIP-2 chain ID.
 * @returns The slip44 asset ID.
 */
export function getSlip44AssetId(
  scope: KnownCaip2ChainId,
): KnownCaip19Slip44Id {
  return KnownCaip19Slip44IdMap[scope];
}

/**
 * Converts the given asset reference to a CAIP-19 asset reference.
 *
 * @param assetRef - The asset reference.
 * @returns The CAIP-19 asset reference.
 */
export function toCaipAssetReference(assetRef: string): string {
  // TODO: change to sep41 asset reference detection
  if (!assetRef.includes(':')) {
    return assetRef;
  }
  // TODO: change to classic asset reference detection
  const [assetCode, assetIssuer] = assetRef.split(':');
  if (!assetCode || !assetIssuer) {
    throw new Error(`Invalid asset reference: ${assetRef}`);
  }
  return `${assetCode}-${assetIssuer}`;
}

/**
 * Parses classic asset code and issuer from CAIP-19 form (`CODE-ISSUER`) or colon form (`CODE:ISSUER`).
 *
 * @param assetReference - Classic asset reference segment from CAIP-19 or on-chain metadata.
 * @returns Parsed asset code and issuer account id.
 * @example
 * ```
 * parseClassicAssetCodeIssuer('USD-G1234567890123456789012345678901234567890');
 * // { assetCode: 'USD', assetIssuer: 'G1234567890123456789012345678901234567890' }
 * parseClassicAssetCodeIssuer('USD:G1234567890123456789012345678901234567890');
 * // { assetCode: 'USD', assetIssuer: 'G1234567890123456789012345678901234567890' }
 * ```
 */
export function parseClassicAssetCodeIssuer(assetReference: string): {
  assetCode: string;
  assetIssuer: string;
} {
  // TODO: change to classic asset reference detection
  const separator = assetReference.includes(':') ? ':' : '-';
  const [assetCode, assetIssuer] = assetReference.split(separator);
  if (!assetCode || !assetIssuer) {
    throw new Error(`Invalid asset reference: ${assetReference}`);
  }
  return { assetCode, assetIssuer };
}
