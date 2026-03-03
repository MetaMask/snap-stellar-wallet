import { KnownCaip19ChainId } from './network';

/** Stellar Asset namespace */
/** please see https://namespaces.chainagnostic.org/stellar/caip19#asset-namespaces */
export enum NativeAssetType {
  Native = 'slip44',
  Token = 'asset',
}

/** Stellar's coin type */
/** please see https://github.com/satoshilabs/slips/blob/master/slip-0044.md */
export const CoinType = 148;

/** Known CAIP-19 IDs */
export enum KnownCaip19Id {
  Slip44Mainnet = `${KnownCaip19ChainId.Mainnet}/${NativeAssetType.Native}:${CoinType}`,
  Slip44Testnet = `${KnownCaip19ChainId.Testnet}/${NativeAssetType.Native}:${CoinType}`,
}
