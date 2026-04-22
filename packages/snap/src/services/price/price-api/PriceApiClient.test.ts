import { GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT } from '../api';
import { PriceApiException } from './exceptions';
import { PriceApiClient } from './PriceApiClient';
import { buildUrl, logger } from '../../../utils';

jest.mock('../../../utils/logger');

const jsonResponse = (
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response => {
  const { ok = true, status = ok ? 200 : 500 } = init;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
};

const baseUrl = 'https://price.test';

/** Known-valid Stellar CAIP asset ids (see `api/asset.test.ts`). */
const stellarClassicUsdc =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const;

const stellarSep41 =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as const;

const minimalSpotPrice = (id: string, price: number) => ({
  id,
  price,
});

describe('PriceApiClient', () => {
  const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createClient = (chunkSize = 10) =>
    new PriceApiClient({ baseUrl, chunkSize }, logger, mockFetch);

  describe('getFiatExchangeRates', () => {
    it('requests fiat exchange rates endpoint and returns parsed body', async () => {
      const body = {
        usd: {
          name: 'US Dollar',
          ticker: 'usd' as const,
          value: 1,
          currencyType: 'fiat' as const,
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const client = createClient();
      expect(await client.getFiatExchangeRates()).toStrictEqual(body);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v1/exchange-rates/fiat',
        }),
      );
    });

    it('throws PriceApiException when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({}, { ok: false, status: 502 }),
      );

      const client = createClient();
      await expect(client.getFiatExchangeRates()).rejects.toThrow(
        PriceApiException,
      );
    });

    it('throws PriceApiException when response body fails validation', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ invalid: true }));

      const client = createClient();
      await expect(client.getFiatExchangeRates()).rejects.toThrow(
        PriceApiException,
      );
    });

    it('throws PriceApiException when fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      const client = createClient();
      await expect(client.getFiatExchangeRates()).rejects.toThrow(
        PriceApiException,
      );
    });
  });

  describe('getSpotPrices', () => {
    it('returns empty object when assetIds is empty', async () => {
      const client = createClient();
      expect(await client.getSpotPrices([])).toStrictEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('requests spot prices with default vsCurrency and includeMarketData', async () => {
      const spotBody = {
        [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(spotBody));

      const client = createClient();
      expect(await client.getSpotPrices([stellarClassicUsdc])).toStrictEqual(
        spotBody,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v3/spot-prices',
          queryParams: {
            vsCurrency: 'usd',
            assetIds: stellarClassicUsdc,
            includeMarketData: 'true',
          },
        }),
      );
    });

    it('passes custom vsCurrency in query params', async () => {
      const spotBody = {
        [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(spotBody));

      const client = createClient();
      await client.getSpotPrices([stellarClassicUsdc], 'eur');

      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v3/spot-prices',
          queryParams: {
            vsCurrency: 'eur',
            assetIds: stellarClassicUsdc,
            includeMarketData: 'true',
          },
        }),
      );
    });

    it('deduplicates assetIds before batching', async () => {
      const spotBody = {
        [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(spotBody));

      const client = createClient();
      await client.getSpotPrices([stellarClassicUsdc, stellarClassicUsdc]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const urlArg = mockFetch.mock.calls[0]?.[0] as string;
      expect(new URL(urlArg).searchParams.get('assetIds')).toBe(
        stellarClassicUsdc,
      );
    });

    it('splits requests by chunkSize and merges batch results', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            [stellarSep41]: minimalSpotPrice('sep41', 0.12),
          }),
        );

      const client = createClient(1);
      expect(
        await client.getSpotPrices([stellarClassicUsdc, stellarSep41]),
      ).toStrictEqual({
        [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
        [stellarSep41]: minimalSpotPrice('sep41', 0.12),
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty spot prices and logs when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({}, { ok: false, status: 503 }),
      );

      const client = createClient();
      expect(await client.getSpotPrices([stellarClassicUsdc])).toStrictEqual(
        {},
      );
    });

    it('returns empty spot prices and logs when response body fails validation', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ notValid: true }));

      const client = createClient();
      expect(await client.getSpotPrices([stellarClassicUsdc])).toStrictEqual(
        {},
      );
    });

    it('returns empty spot prices and logs when fetch rejects', async () => {
      const networkError = new Error('network down');
      mockFetch.mockRejectedValueOnce(networkError);

      const client = createClient();
      expect(await client.getSpotPrices([stellarClassicUsdc])).toStrictEqual(
        {},
      );
    });

    it('merges successful batches and skips failed batches', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

      const client = createClient(1);
      expect(
        await client.getSpotPrices([stellarClassicUsdc, stellarSep41]),
      ).toStrictEqual({
        [stellarClassicUsdc]: minimalSpotPrice('usdc', 1),
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHistoricalPrices', () => {
    it('requests historical prices with path and query params', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT),
      );

      const client = createClient();
      expect(
        await client.getHistoricalPrices({
          assetType: stellarClassicUsdc,
          timePeriod: '7d',
          from: 1,
          to: 2,
          vsCurrency: 'usd',
        }),
      ).toStrictEqual(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v3/historical-prices/{assetType}',
          pathParams: { assetType: stellarClassicUsdc },
          queryParams: {
            timePeriod: '7d',
            from: '1',
            to: '2',
            vsCurrency: 'usd',
          },
          encodePathParams: false,
        }),
      );
    });

    it('includes from and to in query when both are zero', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT),
      );

      const client = createClient();
      expect(
        await client.getHistoricalPrices({
          assetType: stellarClassicUsdc,
          from: 0,
          to: 0,
        }),
      ).toStrictEqual(GET_HISTORICAL_PRICES_RESPONSE_NULL_OBJECT);

      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v3/historical-prices/{assetType}',
          pathParams: { assetType: stellarClassicUsdc },
          queryParams: {
            from: '0',
            to: '0',
          },
          encodePathParams: false,
        }),
      );
    });

    it('throws PriceApiException when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({}, { ok: false, status: 502 }),
      );

      const client = createClient();
      await expect(
        client.getHistoricalPrices({
          assetType: stellarClassicUsdc,
          timePeriod: '7d',
        }),
      ).rejects.toThrow(PriceApiException);
    });

    it('throws PriceApiException when response body fails validation', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ invalid: true }));

      const client = createClient();
      await expect(
        client.getHistoricalPrices({
          assetType: stellarClassicUsdc,
        }),
      ).rejects.toThrow(PriceApiException);
    });
  });
});
