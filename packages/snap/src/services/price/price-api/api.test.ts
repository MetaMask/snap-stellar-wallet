import { assert, StructError } from '@metamask/superstruct';
import { cloneDeep, set } from 'lodash';

import {
  ExchangeRateStruct,
  FiatExchangeRatesResponseStruct,
  GetHistoricalPricesParamsStruct,
  GetHistoricalPricesResponseStruct,
  SpotPriceStruct,
  SpotPricesStruct,
  type SpotPrices,
} from './api';
import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from '../api';

const stellarClassicUsdc =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const;

const validSpotPrices: SpotPrices = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501': {
    id: 'solana',
    price: 150,
  },
  'eip155:1/slip44:60': {
    id: 'ethereum',
    price: 2000,
  },
  [stellarClassicUsdc]: null,
};

describe('price-api structs', () => {
  describe('ExchangeRateStruct', () => {
    it('accepts a fiat exchange rate row', () => {
      expect(() =>
        assert(
          {
            name: 'US Dollar',
            ticker: 'usd',
            value: 1,
            currencyType: 'fiat',
          },
          ExchangeRateStruct,
        ),
      ).not.toThrow();
    });

    it('rejects negative value', () => {
      expect(() =>
        assert(
          {
            name: 'US Dollar',
            ticker: 'usd',
            value: -1,
            currencyType: 'fiat',
          },
          ExchangeRateStruct,
        ),
      ).toThrow(StructError);
    });

    it('rejects unknown ticker', () => {
      expect(() =>
        assert(
          {
            name: 'X',
            ticker: 'not-a-ticker',
            value: 1,
            currencyType: 'crypto',
          },
          ExchangeRateStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('FiatExchangeRatesResponseStruct', () => {
    it('accepts a record keyed by ticker', () => {
      expect(() =>
        assert(
          {
            usd: {
              name: 'US Dollar',
              ticker: 'usd',
              value: 1,
              currencyType: 'fiat',
            },
            btc: {
              name: 'Bitcoin',
              ticker: 'btc',
              value: 50000,
              currencyType: 'crypto',
            },
          },
          FiatExchangeRatesResponseStruct,
        ),
      ).not.toThrow();
    });

    it('rejects invalid top-level key', () => {
      expect(() =>
        assert(
          {
            notATicker: {
              name: 'X',
              ticker: 'usd',
              value: 1,
              currencyType: 'fiat',
            },
          },
          FiatExchangeRatesResponseStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('SpotPriceStruct', () => {
    it('accepts minimal spot price fields', () => {
      expect(() =>
        assert({ id: 'xlm', price: 0.12 }, SpotPriceStruct),
      ).not.toThrow();
    });

    it('rejects negative price', () => {
      expect(() =>
        assert({ id: 'xlm', price: -0.01 }, SpotPriceStruct),
      ).toThrow(StructError);
    });
  });

  describe('SpotPricesStruct', () => {
    it('accepts valid spot prices map including null entry', () => {
      expect(() => assert(validSpotPrices, SpotPricesStruct)).not.toThrow();
    });

    it('rejects negative price on an asset', () => {
      const spotPricesWithInvalidPrice = cloneDeep(validSpotPrices);
      set(
        spotPricesWithInvalidPrice,
        ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501', 'price'],
        -4,
      );

      expect(() =>
        assert(spotPricesWithInvalidPrice, SpotPricesStruct),
      ).toThrow(StructError);
    });

    it('rejects invalid CAIP asset key', () => {
      expect(() =>
        assert(
          {
            'invalid-asset-key': { id: 'x', price: 1 },
          },
          SpotPricesStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('GetHistoricalPricesParamsStruct', () => {
    it('accepts full params', () => {
      expect(() =>
        assert(
          {
            assetType: stellarClassicUsdc,
            timePeriod: '7d',
            from: 0,
            to: 1,
            vsCurrency: 'usd',
          },
          GetHistoricalPricesParamsStruct,
        ),
      ).not.toThrow();
    });

    it('accepts only required assetType', () => {
      expect(() =>
        assert(
          { assetType: stellarClassicUsdc },
          GetHistoricalPricesParamsStruct,
        ),
      ).not.toThrow();
    });

    it('rejects invalid timePeriod pattern', () => {
      expect(() =>
        assert(
          {
            assetType: stellarClassicUsdc,
            timePeriod: '0d',
          },
          GetHistoricalPricesParamsStruct,
        ),
      ).toThrow(StructError);
    });

    it('rejects negative from timestamp', () => {
      expect(() =>
        assert(
          {
            assetType: stellarClassicUsdc,
            from: -1,
          },
          GetHistoricalPricesParamsStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('GetHistoricalPricesResponseStruct', () => {
    it('accepts tuple series arrays', () => {
      expect(() =>
        assert(
          {
            prices: [
              [1_700_000_000_000, 0.12],
              [1_700_006_400_000, 0.13],
            ],
            marketCaps: [[1_700_000_000_000, 1e9]],
            totalVolumes: [[1_700_000_000_000, 5e6]],
          },
          GetHistoricalPricesResponseStruct,
        ),
      ).not.toThrow();
    });

    it('accepts empty series', () => {
      expect(() =>
        assert(
          GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT,
          GetHistoricalPricesResponseStruct,
        ),
      ).not.toThrow();
    });

    it('rejects malformed price point', () => {
      expect(() =>
        assert(
          {
            prices: [[1, 2, 3]],
            marketCaps: [],
            totalVolumes: [],
          },
          GetHistoricalPricesResponseStruct,
        ),
      ).toThrow(StructError);
    });
  });
});
