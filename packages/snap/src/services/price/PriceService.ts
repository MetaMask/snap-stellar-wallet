import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { AppConfig } from '../../config';
import type { ILogger, Serializable } from '../../utils';
import type { ICache } from '../cache';
import { useCache } from '../cache';
import type {
  FiatExchangeRatesResponse,
  GetHistoricalPricesParams,
  GetHistoricalPricesResponse,
  SpotPrices,
  VsCurrencyParam,
} from './price-api/api';
import { PriceApiClient } from './price-api/PriceApiClient';

export class PriceService {
  readonly #priceApiClient: PriceApiClient;

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
  }

  /**
   * Get the spot prices for a list of asset IDs.
   * Results are cached for `AppConfig.cache.ttlMilliseconds.spotPrices`.
   *
   * @param params - The parameters for the request.
   * @param params.assetIds - The asset IDs to get the spot prices for.
   * @param params.vsCurrency - The currency to convert the prices to.
   * @param refreshCache - Whether to refresh the cache.
   * @returns The spot prices for the asset IDs.
   */
  async getSpotPrices(
    {
      assetIds,
      vsCurrency = 'usd',
    }: {
      assetIds: KnownCaip19AssetIdOrSlip44Id[];
      vsCurrency?: VsCurrencyParam | string;
    },
    refreshCache: boolean = false,
  ): Promise<Partial<SpotPrices>> {
    return useCache(
      this.#priceApiClient.getSpotPrices.bind(this.#priceApiClient),
      this.#cache,
      {
        functionName: 'PriceService:getSpotPrices',
        ttlMilliseconds: AppConfig.cache.ttlMilliseconds.spotPrices,
        refreshCache,
      },
    )(assetIds, vsCurrency);
  }

  /**
   * Get the fiat exchange rates.
   * Results are cached for `AppConfig.cache.ttlMilliseconds.fiatExchangeRates`.
   *
   * @param refreshCache - Whether to refresh the cache.
   * @returns The fiat exchange rates.
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
   * Get the historical prices for a token.
   * Results are cached for `AppConfig.cache.ttlMilliseconds.historicalPrices`.
   *
   * @param params - The parameters for the request.
   * @param params.vsCurrency - Defaults to `usd` when omitted.
   * @param refreshCache - Whether to refresh the cache.
   * @returns The historical prices for the token.
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
}
