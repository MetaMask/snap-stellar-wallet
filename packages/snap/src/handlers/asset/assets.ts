import type {
  OnAssetHistoricalPriceArguments,
  OnAssetHistoricalPriceResponse,
  OnAssetsConversionArguments,
  OnAssetsConversionResponse,
  OnAssetsLookupArguments,
  OnAssetsLookupResponse,
  OnAssetsMarketDataArguments,
  OnAssetsMarketDataResponse,
} from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';

import { OnAssetsLookupRequestStruct } from './api';
import type { AssetMetadataService } from '../../services/asset-metadata/AssetMetadataService';
import type { PriceService } from '../../services/price/PriceService';
import { withCatchAndThrowSnapError } from '../../utils/errors';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class AssetsHandler {
  readonly #logger: ILogger;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #priceService: PriceService;

  constructor({
    logger,
    assetMetadataService,
    priceService,
  }: {
    logger: ILogger;
    assetMetadataService: AssetMetadataService;
    priceService: PriceService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🪙 AssetsHandler]');
    this.#assetMetadataService = assetMetadataService;
    this.#priceService = priceService;
  }

  async onAssetHistoricalPrice(
    params: OnAssetHistoricalPriceArguments,
  ): Promise<OnAssetHistoricalPriceResponse> {
    return await withCatchAndThrowSnapError(async () => {
      this.#logger.log('[📈 onAssetHistoricalPrice]', params);

      const { from, to } = params;

      const historicalPrice =
        await this.#priceService.getHistoricalPriceWithAllTimePeriods(from, to);

      return {
        historicalPrice,
      };
    });
  }

  async onAssetsConversion(
    params: OnAssetsConversionArguments,
  ): Promise<OnAssetsConversionResponse> {
    return await withCatchAndThrowSnapError(async () => {
      this.#logger.log('[📈 onAssetsConversion]', params);

      const { conversions } = params;

      const conversionRates =
        await this.#priceService.getMultipleTokenConversions(conversions);

      return {
        conversionRates,
      };
    });
  }

  async onAssetsLookup(
    params: OnAssetsLookupArguments,
  ): Promise<OnAssetsLookupResponse> {
    return await withCatchAndThrowSnapError(async () => {
      this.#logger.log('[🔍 onAssetsLookup]', params);
      // Ensure we only support Stellar assets here.
      assert(params, OnAssetsLookupRequestStruct);

      const assetMetadata =
        await this.#assetMetadataService.getAssetsMetadataByAssetIds(
          params.assets,
        );

      return {
        assets: assetMetadata,
      };
    });
  }

  async onAssetsMarketData(
    params: OnAssetsMarketDataArguments,
  ): Promise<OnAssetsMarketDataResponse> {
    return await withCatchAndThrowSnapError(async () => {
      this.#logger.log('[🔍 onAssetsMarketData]', params);

      const marketData = await this.#priceService.getMultipleTokensMarketData(
        params.assets,
      );

      return { marketData };
    });
  }
}
