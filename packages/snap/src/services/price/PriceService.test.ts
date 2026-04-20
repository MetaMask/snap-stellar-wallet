import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from './api';
import { PriceService } from './PriceService';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { AppConfig } from '../../config';
import { logger, serialize } from '../../utils';
import type { FiatExchangeRatesResponse } from './price-api/api';
import { PriceApiClient } from './price-api/PriceApiClient';
import { createMemoryCache } from '../cache/__mocks__/cache.fixtures';

jest.mock('../../utils/logger');

const stellarClassicUsdc =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const satisfies KnownCaip19AssetIdOrSlip44Id;

const fiatExchangeRatesBody = {
  usd: {
    name: 'US Dollar',
    ticker: 'usd' as const,
    value: 1,
    currencyType: 'fiat' as const,
  },
} as FiatExchangeRatesResponse;

const cacheKeySpotPrices = (
  assetIds: KnownCaip19AssetIdOrSlip44Id[],
  vsCurrency: string,
) =>
  `PriceService:getSpotPrices:${JSON.stringify(serialize(assetIds))}:${JSON.stringify(serialize(vsCurrency))}`;

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
      const key = cacheKeySpotPrices([stellarClassicUsdc], 'usd');
      expect(cache.set).toHaveBeenCalledWith(
        key,
        spotResult,
        AppConfig.cache.ttlMilliseconds.spotPrices,
      );
    });

    it('returns cached spot prices without calling PriceApiClient', async () => {
      const { cache, store } = createMemoryCache();
      const service = new PriceService({ cache, logger });
      const cached = { [stellarClassicUsdc]: null };
      const key = cacheKeySpotPrices([stellarClassicUsdc], 'eur');

      store.set(key, cached);

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
      const key = cacheKeySpotPrices([stellarClassicUsdc], 'usd');

      store.set(key, { [stellarClassicUsdc]: null });

      await service.getSpotPrices(
        { assetIds: [stellarClassicUsdc], vsCurrency: 'usd' },
        true,
      );

      expect(getSpotPricesSpy).toHaveBeenCalledTimes(1);
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
});
