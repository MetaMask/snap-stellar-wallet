import type { CaipAssetId } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';
import { Asset, Networks } from '@stellar/stellar-sdk';

import type { KnownCaip19AssetId } from '../../api';
import { KnownCaip2ChainId, KnownCaip19Slip44Id } from '../../api';

const StellarNetwork: Record<KnownCaip2ChainId, Networks> = {
  [KnownCaip2ChainId.Mainnet]: Networks.PUBLIC,
  [KnownCaip2ChainId.Testnet]: Networks.TESTNET,
};

/**
 * Returns the Stellar network passphrase for the given scope (e.g. for transaction building).
 *
 * @param caip2ChainId - The CAIP-2 chain ID.
 * @returns The Stellar Networks passphrase.
 * @throws {Error} If the scope is not supported.
 */
export function getNetwork(caip2ChainId: KnownCaip2ChainId): Networks {
  if (!(caip2ChainId in StellarNetwork)) {
    throw new Error(`Network not found for caip2ChainId: ${caip2ChainId}`);
  }
  return StellarNetwork[caip2ChainId];
}

/**
 * Resolves a Stellar network passphrase to the corresponding CAIP-2 chain ID.
 *
 * @param network - The network name or Stellar Networks enum value.
 * @returns The CAIP-2 chain ID for the network.
 * @throws {Error} If the network is not recognized.
 */
export function getCaip2ChainId(network: string | Networks): KnownCaip2ChainId {
  const networkValue =
    typeof network === 'string' ? (network as Networks) : network;
  const caip2ChainId = (
    Object.keys(StellarNetwork) as KnownCaip2ChainId[]
  ).find((key) => StellarNetwork[key] === networkValue);
  if (!caip2ChainId) {
    throw new Error(`Caip2ChainId not found for network: ${network}`);
  }
  return caip2ChainId;
}

/**
 * Returns the Stellar asset for the given CAIP-19 asset ID.
 *
 * @param caip19AssetId - The CAIP-19 asset ID.
 * @returns The Stellar asset.
 * @throws {Error} If the asset is not recognized.
 */
export function getStellarAsset(
  caip19AssetId: KnownCaip19AssetId | KnownCaip19Slip44Id,
): Asset {
  if (
    caip19AssetId === KnownCaip19Slip44Id.Slip44Mainnet ||
    caip19AssetId === KnownCaip19Slip44Id.Slip44Testnet
  ) {
    return new Asset('native');
  }

  const { assetReference } = parseCaipAssetType(caip19AssetId as CaipAssetId);

  const [assetCode, assetIssuer] = assetReference.split('-');
  if (!assetCode || !assetIssuer) {
    throw new Error(`Invalid asset reference: ${assetReference}`);
  }
  return new Asset(assetCode, assetIssuer);
}
