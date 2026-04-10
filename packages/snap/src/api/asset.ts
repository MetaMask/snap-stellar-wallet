import type { Infer } from '@metamask/superstruct';
import { definePattern } from '@metamask/utils';

import { KnownCaip2ChainId } from './network';
import { STELLAR_COIN_TYPE } from '../constants';

/** Stellar Asset namespace */
/** Please see https://namespaces.chainagnostic.org/stellar/caip19#asset-namespaces */
export enum AssetType {
  Native = 'slip44',
  Token = 'asset',
  Sep41 = 'sep41',
}

/** Known CAIP-19 IDs */
export const KnownCaip19Slip44IdStruct =
  definePattern<`${KnownCaip2ChainId}/${AssetType.Native}:${typeof STELLAR_COIN_TYPE}`>(
    'KnownCaip19Slip44Id',
    /^stellar:(?:pubnet|testnet)\/slip44:148$/u,
  );

export const KnownCaip19Slip44IdMap: Record<
  KnownCaip2ChainId,
  KnownCaip19Slip44Id
> = {
  [KnownCaip2ChainId.Mainnet]: `${KnownCaip2ChainId.Mainnet}/${AssetType.Native}:${STELLAR_COIN_TYPE}`,
  [KnownCaip2ChainId.Testnet]: `${KnownCaip2ChainId.Testnet}/${AssetType.Native}:${STELLAR_COIN_TYPE}`,
};

/**
 * CAIP-19 token asset ID: {chainId}/asset:{assetCode}-{issuerAddress}
 *
 * @see https://namespaces.chainagnostic.org/stellar/caip19#asset-namespaces
 */
export const KnownCaip19ClassicAssetStruct =
  definePattern<`${KnownCaip2ChainId}/${AssetType.Token}:${string}-${string}`>(
    'KnownCaip19ClassicAsset',
    /^stellar:(?:pubnet|testnet)\/asset:[A-Za-z0-9]{1,12}-G[A-Z2-7]{55}$/u,
  );

export const KnownCaip19Sep41AssetStruct =
  definePattern<`${KnownCaip2ChainId}/${AssetType.Sep41}:${string}`>(
    'KnownCaip19Sep41Asset',
    /^stellar:(?:pubnet|testnet)\/sep41:C[A-Z2-7]{55}$/u,
  );

/** CAIP-19 Sep41 asset ID */
export type KnownCaip19Sep41AssetId = Infer<typeof KnownCaip19Sep41AssetStruct>;

/** CAIP-19 Classic asset ID */
export type KnownCaip19ClassicAssetId = Infer<
  typeof KnownCaip19ClassicAssetStruct
>;

/** CAIP-19 slip44 ID */
export type KnownCaip19Slip44Id = Infer<typeof KnownCaip19Slip44IdStruct>;

/** CAIP-19 asset ID */
export type KnownCaip19AssetId =
  | KnownCaip19Sep41AssetId
  | KnownCaip19ClassicAssetId;

/** CAIP-19 asset ID or slip44 ID */
export type KnownCaip19AssetIdOrSlip44Id =
  | KnownCaip19AssetId
  | KnownCaip19Slip44Id;
