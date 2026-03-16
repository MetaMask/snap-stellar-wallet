import type { Infer } from '@metamask/superstruct';
import { definePattern } from '@metamask/utils';

import { KnownCaip2ChainId } from './network';

/** Stellar Asset namespace */
/** Please see https://namespaces.chainagnostic.org/stellar/caip19#asset-namespaces */
export enum AssetType {
  Native = 'slip44',
  Token = 'asset',
}

/** Stellar's coin type */
/** Please see https://github.com/satoshilabs/slips/blob/master/slip-0044.md */
export const STELLAR_COIN_TYPE = 148;

/** Known CAIP-19 IDs */
export enum KnownCaip19Slip44Id {
  Slip44Mainnet = `${KnownCaip2ChainId.Mainnet}/${AssetType.Native}:${STELLAR_COIN_TYPE}`,
  Slip44Testnet = `${KnownCaip2ChainId.Testnet}/${AssetType.Native}:${STELLAR_COIN_TYPE}`,
}

/**
 * CAIP-19 token asset ID: {chainId}/asset:{assetCode}-{issuerAddress}
 *
 * @see https://namespaces.chainagnostic.org/stellar/caip19#asset-namespaces
 */
export const KnownCaip19AssetStruct =
  definePattern<`${KnownCaip2ChainId}/${AssetType.Token}:${string}-${string}`>(
    'KnownCaip19Asset',
    /^stellar:(?:pubnet|testnet)\/asset:[^-]{1,12}-G[A-Z2-7]{55}$/u,
  );

export type KnownCaip19AssetId = Infer<typeof KnownCaip19AssetStruct>;
