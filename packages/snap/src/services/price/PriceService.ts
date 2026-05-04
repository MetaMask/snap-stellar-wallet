import type {
  AssetConversion,
  FungibleAssetMarketData,
  HistoricalPriceIntervals,
} from '@metamask/snaps-sdk';
import type { CaipAssetType } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';
import { mapKeys, pick } from 'lodash';

import {
  createPrefixedLogger,
  getFiatTicker,
  isFiat,
  type ILogger,
  type Serializable,
} from '../../utils';
import type { ICache } from '../cache';
import { useCache } from '../cache';
import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from './api';
import type {
  FiatExchangeRatesResponse,
  GetHistoricalPricesParams,
  GetHistoricalPricesResponse,
  SpotPrice,
  SpotPrices,
  Ticker,
  VsCurrencyParam,
} from './price-api/api';
import { PriceApiClient } from './price-api/PriceApiClient';
import { AppConfig } from '../../config';

/**
 * Time window tokens passed to the Price API for multichain historical snapshots.
 * Single source of truth for {@link PriceService.getHistoricalPriceWithAllTimePeriods}.
 */
export const HISTORICAL_PRICE_TIME_PERIODS = [
  '1d',
  '7d',
  '1m',
  '3m',
  '1y',
  '1000y',
] as const;

export type HistoricalPriceTimePeriod =
  (typeof HISTORICAL_PRICE_TIME_PERIODS)[number];

/**
 * Fetches and caches price data from the MetaMask Price API: spot quotes, fiat
 * exchange rates, historical intervals, cross-asset conversions, and market metrics.
 */
export class PriceService {
  readonly #priceApiClient: PriceApiClient;

  readonly #logger: ILogger;

  readonly #cache: ICache<Serializable>;

  constructor({
    cache,
    logger,
  }: {
    cache: ICache<Serializable>;
    logger: ILogger;
  }) {
    this.#priceApiClient = new PriceApiClient(
      {
        baseUrl: AppConfig.api.priceApi.baseUrl,
        chunkSize: AppConfig.api.priceApi.chunkSize,
      },
      logger,
    );
    this.#cache = cache;
    this.#logger = createPrefixedLogger(logger, '[🪙 PriceService]');
  }

  /**
   * Gets spot prices for the given CAIP asset IDs from the Price API.
   * Results are cached for `AppConfig.cache.ttlMilliseconds.spotPrices`.
   *
   * @param params - Request parameters.
   * @param params.assetIds - CAIP asset types to quote.
   * @param params.vsCurrency - Quote currency (defaults to `usd`).
   * @param refreshCache - When true, bypasses the cache for this call.
   * @returns A promise that resolves to spot price entries keyed by asset ID.
   * Omitted or null entries mean the API did not return data for that asset.
   */
  async getSpotPrices(
    {
      assetIds,
      vsCurrency = 'usd',
    }: {
      assetIds: CaipAssetType[];
      vsCurrency?: VsCurrencyParam | string;
    },
    refreshCache: boolean = false,
  ): Promise<SpotPrices> {
    return this.#getCachedSpotPrices(assetIds, vsCurrency, refreshCache);
  }

  /**
   * Internal caching for {@link PriceService.getSpotPrices}:
   * - Uses `mget` / `mset` for batch reads and writes.
   * - One cache entry per asset and quote currency.
   * - On partial hits, fetches only assets missing from the cache.
   *
   * @param tokenCaip19Types - CAIP-19 asset IDs to quote.
   * @param vsCurrency - Quote currency.
   * @param refreshCache - When true, bypasses the cache for this call.
   * @returns Spot prices keyed by asset ID.
   */
  async #getCachedSpotPrices(
    tokenCaip19Types: CaipAssetType[],
    vsCurrency: VsCurrencyParam | string = 'usd',
    refreshCache: boolean = false,
  ): Promise<SpotPrices> {
    const uniqueTokenCaip19Types = [...new Set(tokenCaip19Types)];

    const cacheKeyPrefix = 'PriceApiClient:getSpotPrices';

    // Shorthand method to generate the cache key
    const toCacheKey = (tokenCaipAssetType: CaipAssetType): string =>
      `${cacheKeyPrefix}:${tokenCaipAssetType}:${vsCurrency}`;

    // Parses back the cache key
    const parseCacheKey = (key: string): RegExpMatchArray => {
      const regex = new RegExp(`^${cacheKeyPrefix}:(.+):(.+)$`, 'u');
      const match = key.match(regex);

      if (!match) {
        throw new Error('Invalid cache key');
      }

      return match;
    };

    // Get the cached spot prices
    const cachedSpotPricesRecord = refreshCache
      ? {}
      : await this.#cache.mget(uniqueTokenCaip19Types.map(toCacheKey));

    // `mget` keys results by full cache keys (`PriceApiClient:getSpotPrices:…`), not by CAIP asset ID; map back to asset IDs.
    const cachedSpotPricesRecordWithParsedKeys = mapKeys(
      cachedSpotPricesRecord,
      (_value, key) => parseCacheKey(key)[1],
    );

    // We still need to fetch the spot prices for the tokens that are not cached
    const nonCachedTokenCaip19Types = uniqueTokenCaip19Types.filter(
      (tokenCaip19Type) =>
        cachedSpotPricesRecordWithParsedKeys[tokenCaip19Type] === undefined,
    );

    if (nonCachedTokenCaip19Types.length === 0) {
      return cachedSpotPricesRecordWithParsedKeys as SpotPrices;
    }

    // Fetch the spot prices for the tokens that are not cached
    const nonCachedSpotPrices = await this.#priceApiClient.getSpotPrices(
      nonCachedTokenCaip19Types,
      vsCurrency,
    );

    // Cache the data
    await this.#cache.mset(
      Object.entries(nonCachedSpotPrices).map(
        ([tokenCaipAssetType, spotPrice]) => ({
          key: toCacheKey(tokenCaipAssetType as CaipAssetType),
          value: spotPrice,
          ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        }),
      ),
    );

    return {
      ...cachedSpotPricesRecordWithParsedKeys,
      ...nonCachedSpotPrices,
    };
  }

  /**
   * Gets exchange rates from the Price API (same payload shape as the fiat-rates
   * endpoint: tickers keyed to name, value, and currency type).
   * Results are cached for `AppConfig.cache.ttlMilliseconds.fiatExchangeRates`.
   *
   * @param refreshCache - When true, bypasses the cache for this call.
   * @returns A promise that resolves to rates keyed by ticker (fiat, crypto, and
   * commodity symbols).
   */
  async getFiatExchangeRates(
    refreshCache: boolean = false,
  ): Promise<FiatExchangeRatesResponse> {
    return useCache(
      this.#priceApiClient.getFiatExchangeRates.bind(this.#priceApiClient),
      this.#cache,
      {
        functionName: 'PriceService:getFiatExchangeRates',
        ttlMilliseconds: AppConfig.cache.ttlMilliseconds.fiatExchangeRates,
        refreshCache,
      },
    )();
  }

  /**
   * Gets historical OHLC-style series for a single asset from the Price API.
   * Results are cached for `AppConfig.cache.ttlMilliseconds.historicalPrices`.
   *
   * @param params - Request parameters.
   * @param params.assetType - CAIP asset type to chart.
   * @param params.timePeriod - Optional window such as `7d` (mutually exclusive
   * with `from`/`to` in typical API usage).
   * @param params.from - Optional range start (unix ms).
   * @param params.to - Optional range end (unix ms).
   * @param params.vsCurrency - Quote currency; defaults to `usd` when omitted.
   * @param refreshCache - When true, bypasses the cache for this call.
   * @returns A promise that resolves to price, market cap, and volume series for the
   * requested range.
   */
  async getHistoricalPrices(
    params: GetHistoricalPricesParams,
    refreshCache: boolean = false,
  ): Promise<GetHistoricalPricesResponse> {
    const { assetType, timePeriod, from, to, vsCurrency = 'usd' } = params;

    return useCache(
      this.#priceApiClient.getHistoricalPrices.bind(this.#priceApiClient),
      this.#cache,
      {
        functionName: 'PriceService:getHistoricalPrices',
        ttlMilliseconds: AppConfig.cache.ttlMilliseconds.historicalPrices,
        refreshCache,
      },
    )({
      assetType,
      ...(timePeriod !== undefined && { timePeriod }),
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
      vsCurrency,
    });
  }

  /**
   * Loads historical prices for `from` in each configured calendar period,
   * quoted in the asset reference parsed from `to` (used as `vsCurrency`).
   * Failed periods return empty series via
   * {@link GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT} so other periods still succeed.
   *
   * @param from - Base CAIP asset type.
   * @param to - Quote asset; its CAIP `assetReference` becomes the vs ticker (lowercase).
   * @returns A promise that resolves to an object with `intervals` (ISO 8601 duration keys,
   * for example `P7D`, mapped to `[timestamp, price]` pairs with string prices), `updateTime`,
   * and optional `expirationTime` so the caller can decide when to refresh cached data.
   * @see https://github.com/MetaMask/core/blob/main/packages/assets-controllers/src/MultichainAssetsRatesController/MultichainAssetsRatesController.ts#L556
   */
  async getHistoricalPriceWithAllTimePeriods(
    from: CaipAssetType,
    to: CaipAssetType,
  ): Promise<{
    intervals: HistoricalPriceIntervals;
    updateTime: number;
    expirationTime?: number;
  }> {
    const toTicker = parseCaipAssetType(to).assetReference.toLowerCase();

    // For each time period, call the Price API to fetch the historical prices
    const promises = HISTORICAL_PRICE_TIME_PERIODS.map(async (timePeriod) =>
      this.getHistoricalPrices(
        {
          assetType: from,
          timePeriod,
          // It is possible that the toTicker is not a valid vsCurrency,
          // but we can safely cast it to VsCurrencyParam because the Price API will throw an error if it is not a valid value
          vsCurrency: toTicker as VsCurrencyParam,
        },
        // Refresh the cache to ensure we get the latest data
        true,
      )
        // Wrap the response in an object with the time period and the response for easier reducing
        .then((response) => ({
          timePeriod,
          response,
        }))
        // Gracefully handle individual errors to avoid breaking the entire operation
        .catch((error) => {
          this.#logger.logErrorWithDetails(
            `Error fetching historical prices for ${from} to ${to} with time period ${timePeriod}. Returning null object.`,
            error,
          );
          return {
            timePeriod,
            response: GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT,
          };
        }),
    );

    const wrappedHistoricalPrices = await Promise.all(promises);

    // Format the response into the expected intervals format
    const intervals = wrappedHistoricalPrices.reduce<HistoricalPriceIntervals>(
      (acc, { timePeriod, response }) => {
        const iso8601Interval = `P${timePeriod.toUpperCase()}`;
        acc[iso8601Interval] = response.prices.map((price) => [
          price[0],
          price[1].toString(),
        ]);
        return acc;
      },
      {},
    );

    // TODO: replace with more accurate expiration time for the result based on the data itself.
    const now = Date.now();

    const result = {
      intervals,
      updateTime: now,
      expirationTime: now + AppConfig.cache.ttlMilliseconds.historicalPrices,
    };

    return result;
  }

  /**
   * Computes pairwise conversion rates between assets (fiat or crypto CAIP IDs).
   * Uses {@link getFiatExchangeRates} and {@link getSpotPrices} (vs USD),
   * then divides USD-equivalent values to obtain each `from`→`to` rate.
   * That USD bridge is an approximation when both legs are not USD-quoted spot.
   * Each {@link AssetConversion}'s `expirationTime` uses the shorter of the spot and
   * fiat-exchange-rate cache TTLs.
   *
   * @param conversions - Pairs of `from` and `to` CAIP asset types.
   * @returns A promise that resolves to a nested record `from` → `to` →
   * {@link AssetConversion} or `null` when either leg has no usable rate.
   */
  async getMultipleTokenConversions(
    conversions: { from: CaipAssetType; to: CaipAssetType }[],
  ): Promise<
    Record<CaipAssetType, Record<CaipAssetType, AssetConversion | null>>
  > {
    if (conversions.length === 0) {
      return {};
    }

    /**
     * `from` and `to` can represent both fiat and crypto assets. For us to get their values
     * the best approach is to use Price API's `getFiatExchangeRates` method for fiat prices,
     * `getMultipleSpotPrices` for crypto prices and then using USD as an intermediate currency
     * to convert the prices to the correct currency.
     */
    const allAssets = conversions.flatMap((conversion) => [
      conversion.from,
      conversion.to,
    ]);

    // Expired time is not being used by the caller,
    // so we should use the cached results.
    const { fiatExchangeRates, cryptoPrices } =
      await this.#fetchPriceData(allAssets);

    /**
     * Now that we have the data, convert the `from`s to `to`s.
     *
     * We need to handle the following cases:
     * 1. `from` and `to` are both fiat
     * 2. `from` and `to` are both crypto
     * 3. `from` is fiat and `to` is crypto
     * 4. `from` is crypto and `to` is fiat
     *
     * We also need to keep in mind that although `cryptoPrices` are indexed
     * by CAIP 19 IDs, the `fiatExchangeRates` are indexed by currency symbols.
     * To convert fiat currency symbols to CAIP 19 IDs, we can use the
     * `this.#fiatSymbolToCaip19Id` method.
     */
    const result: Record<
      CaipAssetType,
      Record<CaipAssetType, AssetConversion | null>
    > = {};

    conversions.forEach((conversion) => {
      const { from, to } = conversion;

      result[from] ??= {};

      const fromUsdRate = this.#calculateConversionRate({
        asset: from,
        fiatExchangeRates,
        cryptoPrices,
      });

      const toUsdRate = this.#calculateConversionRate({
        asset: to,
        fiatExchangeRates,
        cryptoPrices,
      });

      if (fromUsdRate.isZero() || toUsdRate.isZero()) {
        result[from][to] = null;
        return;
      }

      const rate = fromUsdRate.dividedBy(toUsdRate).toString();

      const now = Date.now();

      // Caller is not using the expiration time,
      // so we can just use the minimum of the two fixed TTLs as placeholder.
      const expirationTime = Math.min(
        AppConfig.cache.ttlMilliseconds.spotPrices,
        AppConfig.cache.ttlMilliseconds.fiatExchangeRates,
      );

      result[from][to] = {
        rate,
        conversionTime: now,
        expirationTime: now + expirationTime,
      };
    });

    return result;
  }

  /**
   * Returns fungible market metrics for each crypto `asset`, with monetary fields
   * expressed in the given `unit` (fiat or crypto) using the same USD bridge as
   * {@link getMultipleTokenConversions}.
   *
   * @param assets - Rows with `asset` (must have spot data) and pricing `unit`.
   * @returns A promise that resolves to a nested record `asset` → `unit` →
   * {@link FungibleAssetMarketData}. Assets without spot prices or with a zero
   * `unit` USD rate are omitted from the result.
   */
  async getMultipleTokensMarketData(
    assets: {
      asset: CaipAssetType;
      unit: CaipAssetType;
    }[],
  ): Promise<
    Record<CaipAssetType, Record<CaipAssetType, FungibleAssetMarketData>>
  > {
    if (assets.length === 0) {
      return {};
    }

    /**
     * `asset` and `unit` can represent both fiat and crypto assets. For us to get their values
     * the best approach is to use Price API's `getFiatExchangeRates` method for fiat prices,
     * `getMultipleSpotPrices` for crypto prices and then using USD as an intermediate currency
     * to convert the prices to the correct currency.
     */
    const allAssets = assets.flatMap((asset) => [asset.asset, asset.unit]);

    const { fiatExchangeRates, cryptoPrices } =
      await this.#fetchPriceData(allAssets);

    const result: Record<
      CaipAssetType,
      Record<CaipAssetType, FungibleAssetMarketData>
    > = {};

    assets.forEach((asset) => {
      const { asset: assetType, unit } = asset;

      // Skip if we don't have price data for the asset
      if (!cryptoPrices[assetType]) {
        return;
      }

      const unitUsdRate = this.#calculateConversionRate({
        asset: unit,
        fiatExchangeRates,
        cryptoPrices,
      });

      if (unitUsdRate.isZero()) {
        return;
      }

      // Initialize the nested structure for the asset if it doesn't exist
      result[assetType] ??= {};

      // Store the market data with the unit as the key
      result[assetType][unit] = this.#computeMarketData(
        cryptoPrices[assetType],
        unitUsdRate,
      );
    });

    return result;
  }

  /**
   * Converts USD-denominated spot metrics into the display `unit` by dividing
   * each monetary field by the USD value of one `unit` (see {@link #calculateConversionRate}).
   * Percent change fields are copied unchanged.
   *
   * @param spotPrice - Spot payload for the base asset (from the Price API, vs USD).
   * @param rate - Non-zero USD price of one unit of the quote asset.
   * @returns Market data scaled to the quote `unit`; empty strings where converted
   * monetary inputs are nullish. Circulating supply is not currency-converted; when
   * the spot payload omits or nulls it, the value is `'0'` by design (same as numeric zero).
   */
  #computeMarketData(
    spotPrice: SpotPrice,
    rate: BigNumber,
  ): FungibleAssetMarketData {
    const marketDataInUsd = pick(spotPrice, [
      'marketCap',
      'totalVolume',
      'circulatingSupply',
      'allTimeHigh',
      'allTimeLow',
      'pricePercentChange1h',
      'pricePercentChange1d',
      'pricePercentChange7d',
      'pricePercentChange14d',
      'pricePercentChange30d',
      'pricePercentChange200d',
      'pricePercentChange1y',
    ]);

    // Variations in percent don't need to be converted, they are independent of the currency
    const pricePercentChange = {
      ...this.#includeIfDefined('PT1H', marketDataInUsd.pricePercentChange1h),
      ...this.#includeIfDefined('P1D', marketDataInUsd.pricePercentChange1d),
      ...this.#includeIfDefined('P7D', marketDataInUsd.pricePercentChange7d),
      ...this.#includeIfDefined('P14D', marketDataInUsd.pricePercentChange14d),
      ...this.#includeIfDefined('P30D', marketDataInUsd.pricePercentChange30d),
      ...this.#includeIfDefined(
        'P200D',
        marketDataInUsd.pricePercentChange200d,
      ),
      ...this.#includeIfDefined('P1Y', marketDataInUsd.pricePercentChange1y),
    };

    const marketDataInToCurrency = {
      fungible: true,
      marketCap: this.#toCurrencySafe(marketDataInUsd.marketCap, rate),
      totalVolume: this.#toCurrencySafe(marketDataInUsd.totalVolume, rate),
      // Circulating supply counts tokens in circulation (not a fiat amount); do not divide by `rate`.
      // By design, missing or null from the API is treated as zero (`'0'`), matching other snaps.
      circulatingSupply: (marketDataInUsd.circulatingSupply ?? 0).toString(),
      allTimeHigh: this.#toCurrencySafe(marketDataInUsd.allTimeHigh, rate),
      allTimeLow: this.#toCurrencySafe(marketDataInUsd.allTimeLow, rate),
      //   Add pricePercentChange field only if it has values
      ...(Object.keys(pricePercentChange).length > 0
        ? { pricePercentChange }
        : {}),
    } as FungibleAssetMarketData;

    return marketDataInToCurrency;
  }

  /**
   * Loads exchange rates and USD spot prices needed for conversion and market views.
   * Shared by {@link getMultipleTokenConversions} and {@link getMultipleTokensMarketData}.
   *
   * @param allAssets - Every `from`/`to` or `asset`/`unit` CAIP id involved (duplicates allowed).
   * @param refreshCache - When true, bypasses the cache for this call.
   * @returns A promise that resolves to the full fiat rate table plus a partial spot
   * map for non-fiat ids only (fiat entries are not requested from spot pricing).
   */
  async #fetchPriceData(
    allAssets: CaipAssetType[],
    refreshCache: boolean = false,
  ): Promise<{
    fiatExchangeRates: FiatExchangeRatesResponse;
    cryptoPrices: Partial<SpotPrices>;
  }> {
    const assetIds = allAssets.filter((asset) => !isFiat(asset));

    const [fiatExchangeRates, cryptoPrices] = await Promise.all([
      this.getFiatExchangeRates(refreshCache),
      this.getSpotPrices(
        {
          assetIds,
          vsCurrency: 'usd',
        },
        refreshCache,
      ),
    ]);

    return { fiatExchangeRates, cryptoPrices };
  }

  #calculateConversionRate({
    asset,
    fiatExchangeRates,
    cryptoPrices,
  }: {
    asset: CaipAssetType;
    fiatExchangeRates: FiatExchangeRatesResponse;
    cryptoPrices: Partial<SpotPrices>;
  }): BigNumber {
    if (isFiat(asset)) {
      /**
       * Beware:
       * We need to invert the fiat exchange rate because exchange rate != spot price
       */
      const ticker = getFiatTicker(asset) as Ticker;
      const fiatExchangeRate = fiatExchangeRates[ticker]?.value;

      // if it is falsy, return 0
      if (!fiatExchangeRate) {
        return new BigNumber(0);
      }

      return new BigNumber(1).dividedBy(fiatExchangeRate);
    }
    return new BigNumber(cryptoPrices[asset]?.price ?? 0);
  }

  #includeIfDefined(
    key: string,
    value: number | null | undefined,
  ): Record<string, number> {
    return value === null || value === undefined ? {} : { [key]: value };
  }

  readonly #toCurrencySafe = (
    value: number | null | undefined,
    rate: BigNumber,
  ): string => {
    return value === null || value === undefined
      ? ''
      : new BigNumber(value).dividedBy(rate).toString();
  };
}
