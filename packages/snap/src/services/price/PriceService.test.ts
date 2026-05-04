import type { CaipAssetType } from '@metamask/utils';

import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from './api';
import {
  HISTORICAL_PRICE_TIME_PERIODS,
  type HistoricalPriceTimePeriod,
  PriceService,
} from './PriceService';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { AppConfig } from '../../config';
import { logger, serialize } from '../../utils';
import type {
  FiatExchangeRatesResponse,
  GetHistoricalPricesResponse,
  SpotPrice,
} from './price-api/api';
import { PriceApiClient } from './price-api/PriceApiClient';
import { toCacheKey } from './utils';
import { createMemoryCache } from '../cache/__mocks__/cache.fixtures';

jest.mock('../../utils/logger');

const stellarClassicUsdc =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const satisfies KnownCaip19AssetIdOrSlip44Id;

const fiatUsdCaip = 'swift:0/iso4217:USD' as CaipAssetType;

const fiatEurCaip = 'swift:0/iso4217:EUR' as CaipAssetType;

const stellarTestnetMockAsset =
  'stellar:testnet/asset:MOCK-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const satisfies KnownCaip19AssetIdOrSlip44Id;

const fiatExchangeRatesBody = {
  usd: {
    name: 'US Dollar',
    ticker: 'usd' as const,
    value: 1,
    currencyType: 'fiat' as const,
  },
} as FiatExchangeRatesResponse;

const fiatExchangeRatesUsdEur: FiatExchangeRatesResponse = {
  ...fiatExchangeRatesBody,
  eur: {
    name: 'Euro',
    ticker: 'eur' as const,
    value: 2,
    currencyType: 'fiat' as const,
  },
};

const minimalSpot = (id: string, price: number): SpotPrice => ({
  id,
  price,
});

const SPOT_PRICES_CACHE_KEY_PREFIX = 'PriceApiClient:getSpotPrices' as const;

const cacheKeySpotPrice = (assetId: CaipAssetType, vsCurrency: string) =>
  toCacheKey(SPOT_PRICES_CACHE_KEY_PREFIX, assetId, vsCurrency);

const cacheKeyFiatExchangeRates = () => 'PriceService:getFiatExchangeRates:';

const cacheKeyHistoricalPrices = (params: {
  assetType: KnownCaip19AssetIdOrSlip44Id;
  timePeriod: string;
  from: number;
  to: number;
  vsCurrency: string;
}) => `PriceService:getHistoricalPrices:${JSON.stringify(serialize(params))}`;

describe('PriceService', () => {
  let getSpotPricesSpy: jest.SpiedFunction<PriceApiClient['getSpotPrices']>;
  let getFiatExchangeRatesSpy: jest.SpiedFunction<
    PriceApiClient['getFiatExchangeRates']
  >;
  let getHistoricalPricesSpy: jest.SpiedFunction<
    PriceApiClient['getHistoricalPrices']
  >;

  beforeEach(() => {
    getSpotPricesSpy = jest
      .spyOn(PriceApiClient.prototype, 'getSpotPrices')
      .mockResolvedValue({ [stellarClassicUsdc]: null });
    getFiatExchangeRatesSpy = jest
      .spyOn(PriceApiClient.prototype, 'getFiatExchangeRates')
      .mockResolvedValue(fiatExchangeRatesBody);
    getHistoricalPricesSpy = jest
      .spyOn(PriceApiClient.prototype, 'getHistoricalPrices')
      .mockResolvedValue(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getSpotPrices', () => {
    it('calls PriceApiClient and stores result in cache', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const spotResult = { [stellarClassicUsdc]: null };

      getSpotPricesSpy.mockResolvedValueOnce(spotResult);

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc],
          vsCurrency: 'usd',
        }),
      ).toStrictEqual(spotResult);

      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarClassicUsdc],
        'usd',
      );
      expect(cache.mset).toHaveBeenCalledWith([
        {
          key: cacheKeySpotPrice(stellarClassicUsdc, 'usd'),
          value: null,
          ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        },
      ]);
    });

    it('returns cached spot prices without calling PriceApiClient', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const cached = { [stellarClassicUsdc]: null };

      store.set(cacheKeySpotPrice(stellarClassicUsdc, 'eur'), null);

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc],
          vsCurrency: 'eur',
        }),
      ).toStrictEqual(cached);

      expect(getSpotPricesSpy).not.toHaveBeenCalled();
    });

    it('calls PriceApiClient when refreshCache is true', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      store.set(cacheKeySpotPrice(stellarClassicUsdc, 'usd'), null);

      await service.getSpotPrices(
        { assetIds: [stellarClassicUsdc], vsCurrency: 'usd' },
        true,
      );

      expect(getSpotPricesSpy).toHaveBeenCalledTimes(1);
    });

    it('returns empty object without calling PriceApiClient when assetIds is empty', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(await service.getSpotPrices({ assetIds: [] })).toStrictEqual({});

      expect(getSpotPricesSpy).not.toHaveBeenCalled();
      expect(cache.mget).toHaveBeenCalledWith([]);
      expect(cache.mset).not.toHaveBeenCalled();
    });

    it('deduplicates assetIds before calling PriceApiClient', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const spotResult = {
        [stellarClassicUsdc]: minimalSpot(stellarClassicUsdc, 1),
      };

      getSpotPricesSpy.mockResolvedValueOnce(spotResult);

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc, stellarClassicUsdc],
          vsCurrency: 'usd',
        }),
      ).toStrictEqual(spotResult);

      expect(getSpotPricesSpy).toHaveBeenCalledTimes(1);
      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarClassicUsdc],
        'usd',
      );
      expect(cache.mset).toHaveBeenCalledWith([
        {
          key: cacheKeySpotPrice(stellarClassicUsdc, 'usd'),
          value: spotResult[stellarClassicUsdc],
          ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        },
      ]);
    });

    it('uses default vsCurrency usd when vsCurrency is omitted', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const spotResult = { [stellarClassicUsdc]: null };

      getSpotPricesSpy.mockResolvedValueOnce(spotResult);

      await service.getSpotPrices({ assetIds: [stellarClassicUsdc] });

      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarClassicUsdc],
        'usd',
      );
      expect(cache.mset).toHaveBeenCalledWith([
        {
          key: cacheKeySpotPrice(stellarClassicUsdc, 'usd'),
          value: null,
          ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        },
      ]);
    });

    it('fetches only assets missing from cache on partial hit', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const cachedPrice = minimalSpot(stellarClassicUsdc, 0.99);
      const mockPrice = minimalSpot(stellarTestnetMockAsset, 2);

      store.set(cacheKeySpotPrice(stellarClassicUsdc, 'usd'), cachedPrice);

      getSpotPricesSpy.mockResolvedValueOnce({
        [stellarTestnetMockAsset]: mockPrice,
      });

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc, stellarTestnetMockAsset],
          vsCurrency: 'usd',
        }),
      ).toStrictEqual({
        [stellarClassicUsdc]: cachedPrice,
        [stellarTestnetMockAsset]: mockPrice,
      });

      expect(getSpotPricesSpy).toHaveBeenCalledTimes(1);
      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarTestnetMockAsset],
        'usd',
      );
      expect(cache.mset).toHaveBeenCalledWith([
        {
          key: cacheKeySpotPrice(stellarTestnetMockAsset, 'usd'),
          value: mockPrice,
          ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        },
      ]);
    });

    it('returns all assets from cache when every asset is cached', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const usdcPrice = minimalSpot(stellarClassicUsdc, 1);
      const mockPrice = minimalSpot(stellarTestnetMockAsset, 3);

      store.set(cacheKeySpotPrice(stellarClassicUsdc, 'usd'), usdcPrice);
      store.set(cacheKeySpotPrice(stellarTestnetMockAsset, 'usd'), mockPrice);

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc, stellarTestnetMockAsset],
          vsCurrency: 'usd',
        }),
      ).toStrictEqual({
        [stellarClassicUsdc]: usdcPrice,
        [stellarTestnetMockAsset]: mockPrice,
      });

      expect(getSpotPricesSpy).not.toHaveBeenCalled();
      expect(cache.mset).not.toHaveBeenCalled();
    });

    it('does not reuse cache across different vsCurrency values', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const usdPrice = minimalSpot(stellarClassicUsdc, 1);

      store.set(cacheKeySpotPrice(stellarClassicUsdc, 'usd'), usdPrice);
      getSpotPricesSpy.mockResolvedValueOnce({
        [stellarClassicUsdc]: minimalSpot(stellarClassicUsdc, 0.9),
      });

      expect(
        await service.getSpotPrices({
          assetIds: [stellarClassicUsdc],
          vsCurrency: 'eur',
        }),
      ).toStrictEqual({
        [stellarClassicUsdc]: minimalSpot(stellarClassicUsdc, 0.9),
      });

      expect(getSpotPricesSpy).toHaveBeenCalledTimes(1);
      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarClassicUsdc],
        'eur',
      );
    });
  });

  describe('getFiatExchangeRates', () => {
    it('calls PriceApiClient and stores result in cache', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(await service.getFiatExchangeRates()).toStrictEqual(
        fiatExchangeRatesBody,
      );

      expect(getFiatExchangeRatesSpy).toHaveBeenCalledTimes(1);
      const key = cacheKeyFiatExchangeRates();
      expect(cache.set).toHaveBeenCalledWith(
        key,
        fiatExchangeRatesBody,
        AppConfig.cache.ttlMilliseconds.fiatExchangeRates,
      );
    });

    it('returns cached fiat rates without calling PriceApiClient', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const key = cacheKeyFiatExchangeRates();

      store.set(key, fiatExchangeRatesBody);

      expect(await service.getFiatExchangeRates()).toStrictEqual(
        fiatExchangeRatesBody,
      );

      expect(getFiatExchangeRatesSpy).not.toHaveBeenCalled();
    });

    it('calls PriceApiClient when refreshCache is true', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      store.set(cacheKeyFiatExchangeRates(), fiatExchangeRatesBody);

      await service.getFiatExchangeRates(true);

      expect(getFiatExchangeRatesSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getHistoricalPrices', () => {
    const historicalParams = {
      assetType: stellarClassicUsdc,
      timePeriod: '7d',
      from: 1,
      to: 2,
      vsCurrency: 'usd' as const,
    };

    const historicalRequestPayload = {
      assetType: stellarClassicUsdc,
      timePeriod: '7d',
      from: 1,
      to: 2,
      vsCurrency: 'usd',
    };

    it('calls PriceApiClient and stores result in cache', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(await service.getHistoricalPrices(historicalParams)).toStrictEqual(
        GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT,
      );

      expect(getHistoricalPricesSpy).toHaveBeenCalledWith(
        historicalRequestPayload,
      );
      const key = cacheKeyHistoricalPrices(historicalRequestPayload);
      expect(cache.set).toHaveBeenCalledWith(
        key,
        GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT,
        AppConfig.cache.ttlMilliseconds.historicalPrices,
      );
    });

    it('returns cached historical prices without calling PriceApiClient', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const key = cacheKeyHistoricalPrices(historicalRequestPayload);

      store.set(key, GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

      expect(await service.getHistoricalPrices(historicalParams)).toStrictEqual(
        GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT,
      );

      expect(getHistoricalPricesSpy).not.toHaveBeenCalled();
    });

    it('calls PriceApiClient when refreshCache is true', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const key = cacheKeyHistoricalPrices(historicalRequestPayload);

      store.set(key, GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

      await service.getHistoricalPrices(historicalParams, true);

      expect(getHistoricalPricesSpy).toHaveBeenCalledTimes(1);
    });

    it('defaults vsCurrency and forwards zero from and to', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(
        await service.getHistoricalPrices({
          assetType: stellarClassicUsdc,
          from: 0,
          to: 0,
        }),
      ).toStrictEqual(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

      expect(getHistoricalPricesSpy).toHaveBeenCalledWith({
        assetType: stellarClassicUsdc,
        from: 0,
        to: 0,
        vsCurrency: 'usd',
      });
    });
  });

  describe('getHistoricalPriceWithAllTimePeriods', () => {
    it('requests each configured time period with vsCurrency from quote asset', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getHistoricalPricesSpy.mockResolvedValue({
        prices: [[1_700_000_000_000, 0.12]],
        marketCaps: [],
        totalVolumes: [],
      });

      await service.getHistoricalPriceWithAllTimePeriods(
        stellarClassicUsdc,
        fiatUsdCaip,
      );

      expect(getHistoricalPricesSpy).toHaveBeenCalledTimes(
        HISTORICAL_PRICE_TIME_PERIODS.length,
      );

      HISTORICAL_PRICE_TIME_PERIODS.forEach((timePeriod) => {
        expect(getHistoricalPricesSpy).toHaveBeenCalledWith({
          assetType: stellarClassicUsdc,
          timePeriod,
          vsCurrency: 'usd',
        });
      });
    });

    it('returns intervals keyed by ISO 8601 durations with stringified prices', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      const historicalByPeriod = {
        '1d': { prices: [[1, 0.5]], marketCaps: [], totalVolumes: [] },
        '7d': { prices: [[1, 2]], marketCaps: [], totalVolumes: [] },
        '1m': { prices: [[1, 2]], marketCaps: [], totalVolumes: [] },
        '3m': { prices: [[1, 2]], marketCaps: [], totalVolumes: [] },
        '1y': { prices: [[1, 2]], marketCaps: [], totalVolumes: [] },
        '1000y': { prices: [[1, 2]], marketCaps: [], totalVolumes: [] },
      } satisfies Record<
        HistoricalPriceTimePeriod,
        GetHistoricalPricesResponse
      >;

      getHistoricalPricesSpy.mockImplementation(async (params) => {
        const period = params.timePeriod as keyof typeof historicalByPeriod;
        return historicalByPeriod[period];
      });

      const { intervals } = await service.getHistoricalPriceWithAllTimePeriods(
        stellarClassicUsdc,
        fiatUsdCaip,
      );

      const expectedIntervalKeys = new Set(
        HISTORICAL_PRICE_TIME_PERIODS.map(
          (period) => `P${period.toUpperCase()}`,
        ),
      );
      expect(new Set(Object.keys(intervals))).toStrictEqual(
        expectedIntervalKeys,
      );
      expect(intervals.P1D).toStrictEqual([[1, '0.5']]);
      expect(intervals.P7D).toStrictEqual([[1, '2']]);
    });

    it('sets updateTime and expirationTime using historical prices cache TTL', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getHistoricalPricesSpy.mockResolvedValue({
        prices: [],
        marketCaps: [],
        totalVolumes: [],
      });

      const now = Date.now();
      const result = await service.getHistoricalPriceWithAllTimePeriods(
        stellarClassicUsdc,
        fiatUsdCaip,
      );

      expect(result.updateTime).toBe(now);
      expect(result.expirationTime).toBe(
        now + AppConfig.cache.ttlMilliseconds.historicalPrices,
      );

      jest.useRealTimers();
    });

    it('uses empty price series for a period when the historical request fails', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      const successResponse: GetHistoricalPricesResponse = {
        prices: [[10, 1]],
        marketCaps: [],
        totalVolumes: [],
      };

      const historicalHandlers: Record<
        HistoricalPriceTimePeriod,
        () => Promise<GetHistoricalPricesResponse>
      > = {
        '1d': async () => successResponse,
        '7d': async () => successResponse,
        '1m': async () => successResponse,
        '3m': async () => Promise.reject(new Error('network')),
        '1y': async () => successResponse,
        '1000y': async () => successResponse,
      };

      getHistoricalPricesSpy.mockImplementation(async (params) => {
        const period = params.timePeriod as keyof typeof historicalHandlers;
        return historicalHandlers[period]();
      });

      const { intervals } = await service.getHistoricalPriceWithAllTimePeriods(
        stellarClassicUsdc,
        fiatUsdCaip,
      );

      expect(intervals.P3M).toStrictEqual([]);
      expect(intervals.P1D).toStrictEqual([[10, '1']]);
    });
  });

  describe('getMultipleTokenConversions', () => {
    it('returns empty record when conversions list is empty', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(await service.getMultipleTokenConversions([])).toStrictEqual({});
    });

    it('derives crypto to crypto rate from USD spot prices', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: minimalSpot('usdc', 2),
        [stellarTestnetMockAsset]: minimalSpot('mock', 0.5),
      });

      const result = await service.getMultipleTokenConversions([
        { from: stellarClassicUsdc, to: stellarTestnetMockAsset },
      ]);

      expect(
        result[stellarClassicUsdc]?.[stellarTestnetMockAsset],
      ).toMatchObject({
        rate: '4',
      });
      expect(getSpotPricesSpy).toHaveBeenCalledWith(
        [stellarClassicUsdc, stellarTestnetMockAsset],
        'usd',
      );
    });

    it('returns null when a crypto leg has no usable USD price', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: minimalSpot('usdc', 1),
      });

      const result = await service.getMultipleTokenConversions([
        { from: stellarClassicUsdc, to: stellarTestnetMockAsset },
      ]);

      expect(result[stellarClassicUsdc]?.[stellarTestnetMockAsset]).toBeNull();
    });

    it('derives fiat to fiat rate using inverted exchange rate values', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getFiatExchangeRatesSpy.mockResolvedValue(fiatExchangeRatesUsdEur);
      getSpotPricesSpy.mockResolvedValue({});

      const result = await service.getMultipleTokenConversions([
        { from: fiatUsdCaip, to: fiatEurCaip },
      ]);

      // Fiat USD leg: 1 / usd.value = 1/1. Fiat EUR leg: 1 / eur.value = 1/2.
      // USD→EUR amount multiplier: fromUsdRate / toUsdRate = 1 / 0.5 = 2.
      expect(result[fiatUsdCaip]?.[fiatEurCaip]).toMatchObject({
        rate: '2',
      });
    });

    it('sets expirationTime from the shorter spot or fiat cache TTL', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T00:00:00.000Z'));

      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: minimalSpot('usdc', 1),
        [stellarTestnetMockAsset]: minimalSpot('mock', 1),
      });

      const now = Date.now();
      const ttl = Math.min(
        AppConfig.cache.ttlMilliseconds.spotPrices,
        AppConfig.cache.ttlMilliseconds.fiatExchangeRates,
      );

      const conversions = await service.getMultipleTokenConversions([
        { from: stellarClassicUsdc, to: stellarTestnetMockAsset },
      ]);
      const row = conversions[stellarClassicUsdc]?.[stellarTestnetMockAsset];

      expect(row).toMatchObject({
        conversionTime: now,
        expirationTime: now + ttl,
      });

      jest.useRealTimers();
    });
  });

  describe('getMultipleTokensMarketData', () => {
    it('returns empty record when assets list is empty', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      expect(await service.getMultipleTokensMarketData([])).toStrictEqual({});
    });

    it('omits rows when the base asset has no spot entry', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({});

      const result = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatUsdCaip },
      ]);

      expect(result).toStrictEqual({});
    });

    it('omits rows when the unit has no usable conversion rate', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: minimalSpot('usdc', 1),
      });

      const result = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatEurCaip },
      ]);

      expect(result).toStrictEqual({});
    });

    it('scales USD monetary fields to the quote unit without converting circulating supply', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getFiatExchangeRatesSpy.mockResolvedValue(fiatExchangeRatesUsdEur);
      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: {
          id: 'usdc',
          price: 1,
          marketCap: 1000,
          totalVolume: 200,
          circulatingSupply: 500,
          allTimeHigh: 2,
          allTimeLow: 0.5,
        },
      });

      const result = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatEurCaip },
      ]);

      expect(result[stellarClassicUsdc]?.[fiatEurCaip]).toMatchObject({
        fungible: true,
        marketCap: '2000',
        totalVolume: '400',
        circulatingSupply: '500',
        allTimeHigh: '4',
        allTimeLow: '1',
      });
    });

    it('includes pricePercentChange when spot returns percent fields', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: {
          id: 'usdc',
          price: 1,
          pricePercentChange1d: 1.5,
          pricePercentChange7d: -2,
        },
      });

      const result = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatUsdCaip },
      ]);

      expect(
        result[stellarClassicUsdc]?.[fiatUsdCaip]?.pricePercentChange,
      ).toStrictEqual({
        P1D: 1.5,
        P7D: -2,
      });
    });

    it('uses string zero for circulating supply when spot omits, nulls, or sends zero', async () => {
      const { cache } = createMemoryCache();
      const service = new PriceService({ cache, logger });

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: {
          id: 'usdc',
          price: 1,
          marketCap: 100,
        },
      });

      const omitted = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatUsdCaip },
      ]);

      expect(
        omitted[stellarClassicUsdc]?.[fiatUsdCaip]?.circulatingSupply,
      ).toBe('0');

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: {
          id: 'usdc',
          price: 1,
          marketCap: 100,
          circulatingSupply: null,
        },
      });

      const nulled = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatUsdCaip },
      ]);

      expect(nulled[stellarClassicUsdc]?.[fiatUsdCaip]?.circulatingSupply).toBe(
        '0',
      );

      getSpotPricesSpy.mockResolvedValue({
        [stellarClassicUsdc]: {
          id: 'usdc',
          price: 1,
          marketCap: 1,
          circulatingSupply: 0,
        },
      });

      const explicitZero = await service.getMultipleTokensMarketData([
        { asset: stellarClassicUsdc, unit: fiatUsdCaip },
      ]);

      expect(
        explicitZero[stellarClassicUsdc]?.[fiatUsdCaip]?.circulatingSupply,
      ).toBe('0');
    });
  });
});
