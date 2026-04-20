import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';

export type FeeData = {
  assetId: KnownCaip19AssetIdOrSlip44Id;
  symbol: string;
  iconUrl: string;
  amount: string;
};

export enum FetchStatus {
  Initial = 'initial',
  Fetching = 'fetching',
  Fetched = 'fetched',
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Error = 'error',
}

export type ContextWithPrices = {
  tokenPrices: Record<KnownCaip19AssetIdOrSlip44Id, string | null>;
  tokenPricesFetchStatus: FetchStatus;
  currency: string;
};
