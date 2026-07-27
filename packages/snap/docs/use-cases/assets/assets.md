# Use case: assets (`AssetsHandler`)

Asset metadata and price entry points via Snap Assets API handlers → `AssetsHandler`.

| | |
| --- | --- |
| **Entry** | `onAssetsLookup` / `onAssetsConversion` / `onAssetsMarketData` / `onAssetHistoricalPrice` → `AssetsHandler` |
| **Source** | [`handlers/asset/assets.ts`](../../../src/handlers/asset/assets.ts) |

## Participants

| Component | Path | Role |
| --- | --- | --- |
| `AssetsHandler` | `handlers/asset` | Assets API surface |
| `AssetMetadataService` | `services/asset-metadata` | Resolve CAIP-19 asset metadata |
| `PriceService` | `services/price` | Conversions, market data, historical prices |

## Request / response

Asset methods follow the MetaMask **Snap Assets API** ([SIP-29](https://metamask.github.io/SIPs/SIPS/sip-29)):

- [Entry points](https://docs.metamask.io/snaps/reference/entry-points/) (`onAssetsLookup`, `onAssetsConversion`, `onAssetsMarketData`, `onAssetHistoricalPrice`)

This Snap implements those handlers in `index.ts` and delegates to `AssetsHandler`. Lookup is restricted to Stellar asset ids.

## Methods

| Method | What it does | Data source |
| --- | --- | --- |
| `onAssetsLookup` | Metadata for requested CAIP-19 asset ids | **Snap state** catalog via `AssetMetadataService` (fetch + persist when missing) |
| `onAssetsConversion` | Conversion rates for requested asset pairs | **Price API** via `PriceService` (cached) |
| `onAssetsMarketData` | Market data for requested assets | **Price API** via `PriceService` (cached) |
| `onAssetHistoricalPrice` | Historical price intervals for a `from` → `to` pair | **Price API** via `PriceService` (cached) |
