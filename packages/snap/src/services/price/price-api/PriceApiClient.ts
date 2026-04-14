import { assert } from '@metamask/superstruct';
import type { CaipAssetType } from '@metamask/utils';
import { CaipAssetTypeStruct } from '@metamask/utils';

import type {
  FiatExchangeRatesResponse,
  GetHistoricalPricesParams,
  GetHistoricalPricesResponse,
  SpotPrices,
  VsCurrencyParam,
} from './api';
import {
  FiatExchangeRatesResponseStruct,
  GetHistoricalPricesResponseStruct,
  SpotPricesStruct,
} from './api';
import { PriceApiException } from './exceptions';
import { UrlStruct } from '../../../api';
import type { ILogger } from '../../../utils';
import {
  batchesAllSettled,
  buildUrl,
  chunks as chunkItems,
  logger,
} from '../../../utils';

export class PriceApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #logger: ILogger;

  readonly #baseUrl: string;

  readonly #chunkSize: number;

  static readonly #parallelBatchFetchLimit = 3;

  constructor(
    {
      baseUrl,
      chunkSize,
    }: {
      baseUrl: string;
      chunkSize: number;
    },
    _logger: ILogger = logger,
    _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    assert(baseUrl, UrlStruct);

    this.#fetch = _fetch;
    this.#logger = _logger;
    this.#baseUrl = baseUrl;
    this.#chunkSize = chunkSize;
  }

  async getFiatExchangeRates(): Promise<FiatExchangeRatesResponse> {
    try {
      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/v1/exchange-rates/fiat',
      });

      const response = await this.#fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      assert(data, FiatExchangeRatesResponseStruct);

      return data;
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Error fetching fiat exchange rates',
        error,
      );
      throw new PriceApiException('Error fetching fiat exchange rates');
    }
  }

  /**
   * Get the spot prices for a list of asset IDs.
   *
   * @param assetIds - The asset IDs to get the spot prices for.
   * @param vsCurrency - The currency to convert the prices to.
   * @returns A promise that resolves to the spot prices for the asset IDs.
   * @throws {PriceApiException} If the spot prices cannot be fetched.
   */
  async getSpotPrices(
    assetIds: CaipAssetType[],
    vsCurrency: VsCurrencyParam | string = 'usd',
  ): Promise<Partial<SpotPrices>> {
    try {
      if (assetIds.length === 0) {
        return {};
      }

      const deduplicatedAssetIds = [...new Set(assetIds)];

      // Split into chunks
      const chunks = chunkItems(deduplicatedAssetIds, this.#chunkSize);

      const settled = await batchesAllSettled(
        chunks,
        PriceApiClient.#parallelBatchFetchLimit,
        async (chunk) => this.#fetchSpotPricesBatch(chunk, vsCurrency),
      );

      const response: Partial<SpotPrices> = {};
      for (const entry of settled) {
        if (entry.status === 'rejected') {
          this.#logger.logErrorWithDetails(
            'Error fetching spot prices',
            entry.reason,
          );
          continue;
        }
        for (const [assetId, spotPrice] of Object.entries(entry.value)) {
          assert(assetId, CaipAssetTypeStruct);
          response[assetId] = spotPrice;
        }
      }

      return response;
    } catch (error) {
      this.#logger.logErrorWithDetails('Error fetching spot prices', error);
      throw new PriceApiException('Error fetching spot prices');
    }
  }

  async #fetchSpotPricesBatch(
    assetIds: CaipAssetType[],
    vsCurrency: VsCurrencyParam | string = 'usd',
  ): Promise<SpotPrices> {
    const url = buildUrl({
      baseUrl: this.#baseUrl,
      path: '/v3/spot-prices',
      queryParams: {
        vsCurrency,
        assetIds: assetIds.join(','),
        includeMarketData: 'true',
      },
    });

    const response = await this.#fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const spotPrices = await response.json();
    assert(spotPrices, SpotPricesStruct);

    return spotPrices;
  }

  /**
   * Business logic for `getHistoricalPrices`.
   *
   * @param params - The parameters for the request.
   * @param params.assetType - The asset type of the token.
   * @param params.timePeriod - The time period for the historical prices.
   * @param params.from - The start date for the historical prices.
   * @param params.to - The end date for the historical prices.
   * @param params.vsCurrency - The currency to convert the prices to.
   * @returns The historical prices for the token.
   * @throws {PriceApiException} When the request fails or the response is invalid.
   */
  async getHistoricalPrices(
    params: GetHistoricalPricesParams,
  ): Promise<GetHistoricalPricesResponse> {
    try {
      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/v3/historical-prices/{assetType}',
        pathParams: {
          assetType: params.assetType,
        },
        queryParams: {
          ...(params.timePeriod !== undefined && {
            timePeriod: params.timePeriod,
          }),
          ...(params.from !== undefined && { from: params.from.toString() }),
          ...(params.to !== undefined && { to: params.to.toString() }),
          ...(params.vsCurrency !== undefined && {
            vsCurrency: params.vsCurrency,
          }),
        },
        encodePathParams: false,
      });

      const response = await this.#fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const historicalPrices = await response.json();
      assert(historicalPrices, GetHistoricalPricesResponseStruct);

      return historicalPrices;
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Error fetching historical prices',
        error,
      );
      throw new PriceApiException('Error fetching historical prices');
    }
  }
}
