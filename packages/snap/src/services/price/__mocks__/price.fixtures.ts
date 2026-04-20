import { logger } from '../../../utils/logger';
import { createMemoryCache } from '../../cache/__mocks__/cache.fixtures';
import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from '../api';
import type { FiatExchangeRatesResponse } from '../price-api/api';
import { PriceApiClient } from '../price-api/PriceApiClient';
import { PriceService } from '../PriceService';

const fiatExchangeRatesBody = {
  usd: {
    name: 'US Dollar',
    ticker: 'usd' as const,
    value: 1,
    currencyType: 'fiat' as const,
  },
} as FiatExchangeRatesResponse;

export const createMockPriceService = () => {
  const { cache, store } = createMemoryCache();
  const service = new PriceService({ cache, logger });

  const getSpotPricesSpy = jest
    .spyOn(PriceApiClient.prototype, 'getSpotPrices')
    .mockResolvedValue({});

  const getFiatExchangeRatesSpy = jest
    .spyOn(PriceApiClient.prototype, 'getFiatExchangeRates')
    .mockResolvedValue(fiatExchangeRatesBody);

  const getHistoricalPricesSpy = jest
    .spyOn(PriceApiClient.prototype, 'getHistoricalPrices')
    .mockResolvedValue(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

  const getMultipleTokensMarketDataSpy = jest.spyOn(
    PriceService.prototype,
    'getMultipleTokensMarketData',
  );

  const getMultipleTokenConversionsSpy = jest.spyOn(
    PriceService.prototype,
    'getMultipleTokenConversions',
  );

  const getHistoricalPriceWithAllTimePeriodsSpy = jest.spyOn(
    PriceService.prototype,
    'getHistoricalPriceWithAllTimePeriods',
  );

  return {
    service,
    cache,
    store,
    getSpotPricesSpy,
    getFiatExchangeRatesSpy,
    getHistoricalPricesSpy,
    getMultipleTokensMarketDataSpy,
    getMultipleTokenConversionsSpy,
    getHistoricalPriceWithAllTimePeriodsSpy,
  };
};
