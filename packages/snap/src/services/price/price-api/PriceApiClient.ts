import { assert } from '@metamask/superstruct';
import type { CaipAssetType } from '@metamask/utils';

import type {
  FiatExchangeRatesResponse,
  GetHistoricalPricesParams,
  GetHistoricalPricesResponse,
  SpotPricesResponse,
  VsCurrencyParam,
} from './api';
import {
  FiatExchangeRatesResponseStruct,
  GetHistoricalPricesParamsStruct,
  GetHistoricalPricesResponseStruct,
  GetSpotPricesParamsStruct,
  GetSpotPricesResponseStruct,
} from './api';
import { PriceApiException } from './exceptions';
import { UrlStruct } from '../../../api';
import type { AnyErrorConstructor } from '../../../utils';
import { buildUrl, rethrowIfInstanceElseThrow } from '../../../utils';
import {
  assertHttpRequestParams,
  assertHttpResponse,
  HttpException,
  HttpResponseException,
  InvalidHttpRequestParamsException,
  InvalidHttpResponseException,
  normalizeHttpException,
} from '../../../utils/errors';

export class PriceApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #baseUrl: string;

  constructor(
    {
      baseUrl,
    }: {
      baseUrl: string;
    },
    _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    assert(baseUrl, UrlStruct);

    this.#fetch = _fetch;
    this.#baseUrl = baseUrl;
  }

  async getFiatExchangeRates(): Promise<FiatExchangeRatesResponse> {
    try {
      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/v1/exchange-rates/fiat',
      });

      const response = await this.#fetch(url);

      if (!response.ok) {
        throw new HttpResponseException(response.status);
      }

      const data = await response.json();
      assertHttpResponse(data, FiatExchangeRatesResponseStruct);

      return data;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Error fetching fiat exchange rates',
      });
    }
  }

  async getSpotPrices(
    assetIds: CaipAssetType[],
    vsCurrency: VsCurrencyParam | string = 'usd',
  ): Promise<SpotPricesResponse> {
    try {
      assertHttpRequestParams(
        {
          assetIds,
          vsCurrency,
        },
        GetSpotPricesParamsStruct,
      );

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
        throw new HttpResponseException(response.status);
      }

      const spotPrices = await response.json();
      assertHttpResponse(spotPrices, GetSpotPricesResponseStruct);

      return spotPrices;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Error fetching spot prices',
      });
    }
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
   * @throws {HttpResponseException} When the HTTP response status is not successful.
   * @throws {InvalidHttpResponseException} When the response body is invalid.
   * @throws {PriceApiException} When the request fails for another reason.
   */
  async getHistoricalPrices(
    params: GetHistoricalPricesParams,
  ): Promise<GetHistoricalPricesResponse> {
    try {
      assertHttpRequestParams(params, GetHistoricalPricesParamsStruct);

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
        throw new HttpResponseException(response.status);
      }

      const historicalPrices = await response.json();
      assertHttpResponse(historicalPrices, GetHistoricalPricesResponseStruct);

      return historicalPrices;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Error fetching historical prices',
      });
    }
  }

  #throwError({
    error,
    exceptionClasses,
    fallbackError,
  }: {
    error: unknown;
    exceptionClasses?: readonly AnyErrorConstructor[];
    fallbackError: string | PriceApiException;
  }): never {
    const normalized = normalizeHttpException(error);
    if (normalized instanceof HttpException) {
      throw normalized;
    }

    return rethrowIfInstanceElseThrow(
      normalized,
      [
        PriceApiException,
        InvalidHttpRequestParamsException,
        InvalidHttpResponseException,
        ...(exceptionClasses ?? []),
      ],
      fallbackError instanceof Error
        ? fallbackError
        : new PriceApiException(String(fallbackError), { cause: error }),
    );
  }
}
