import type {
  CaipAssetType,
  FungibleAssetMarketData,
} from '@metamask/snaps-sdk';

import { AssetsHandler } from './assets';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import {
  createMockAssetMetadataService,
  generateMockKeyringAssetMetadata,
  USDC_CLASSIC,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { createMockPriceService } from '../../services/price/__mocks__/price.fixtures';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('AssetsHandler', () => {
  const setupHandlers = () => {
    const { service: assetMetadataService, getAssetsMetadataByAssetIdsSpy } =
      createMockAssetMetadataService();

    const {
      service: priceService,
      getSpotPricesSpy,
      getFiatExchangeRatesSpy,
      getHistoricalPricesSpy,
      getMultipleTokensMarketDataSpy,
      getMultipleTokenConversionsSpy,
      getHistoricalPriceWithAllTimePeriodsSpy,
    } = createMockPriceService();

    const handler = new AssetsHandler({
      logger,
      assetMetadataService,
      priceService,
    });

    return {
      handler,
      getAssetsMetadataByAssetIdsSpy,
      getSpotPricesSpy,
      getFiatExchangeRatesSpy,
      getHistoricalPricesSpy,
      getMultipleTokensMarketDataSpy,
      getMultipleTokenConversionsSpy,
      getHistoricalPriceWithAllTimePeriodsSpy,
    };
  };

  describe('onAssetsLookup', () => {
    it('calls asset metadata once per chain and returns merged metadata', async () => {
      const { handler, getAssetsMetadataByAssetIdsSpy } = setupHandlers();
      const expectedResponse = generateMockKeyringAssetMetadata();
      getAssetsMetadataByAssetIdsSpy.mockResolvedValue(expectedResponse);

      const assets = Object.keys(
        expectedResponse,
      ) as KnownCaip19AssetIdOrSlip44Id[];

      const result = await handler.onAssetsLookup({ assets });

      expect(getAssetsMetadataByAssetIdsSpy).toHaveBeenCalledTimes(1);
      expect(getAssetsMetadataByAssetIdsSpy).toHaveBeenCalledWith(assets);

      expect(result).toMatchObject({
        assets: expectedResponse,
      });
    });
  });

  describe('onAssetsMarketData', () => {
    it('calls price service', async () => {
      const { handler, getMultipleTokensMarketDataSpy } = setupHandlers();
      const expectedResponse: Record<
        CaipAssetType,
        Record<CaipAssetType, FungibleAssetMarketData>
      > = {
        [USDC_CLASSIC]: {
          [USDC_CLASSIC]: {
            fungible: true,
          },
        },
      };
      getMultipleTokensMarketDataSpy.mockResolvedValue(expectedResponse);

      const result = await handler.onAssetsMarketData({
        assets: [
          {
            asset: USDC_CLASSIC,
            unit: 'swift:0/iso4217:USD',
          },
        ],
      });

      expect(getMultipleTokensMarketDataSpy).toHaveBeenCalledWith([
        {
          asset: USDC_CLASSIC,
          unit: 'swift:0/iso4217:USD',
        },
      ]);
      expect(result).toMatchObject({
        marketData: expectedResponse,
      });
    });
  });

  describe('onAssetsConversion', () => {
    it('calls price service', async () => {
      const { handler, getMultipleTokenConversionsSpy } = setupHandlers();
      const expectedResponse = {
        [USDC_CLASSIC]: {
          [USDC_CLASSIC]: {
            rate: '1',
            conversionTime: Date.now(),
          },
        },
      };
      getMultipleTokenConversionsSpy.mockResolvedValue(expectedResponse);

      const result = await handler.onAssetsConversion({
        conversions: [
          {
            from: USDC_CLASSIC,
            to: 'swift:0/iso4217:USD',
          },
        ],
      });

      expect(getMultipleTokenConversionsSpy).toHaveBeenCalledWith([
        {
          from: USDC_CLASSIC,
          to: 'swift:0/iso4217:USD',
        },
      ]);
      expect(result).toMatchObject({
        conversionRates: expectedResponse,
      });
    });
  });

  describe('onAssetHistoricalPrice', () => {
    it('calls price service', async () => {
      const { handler, getHistoricalPriceWithAllTimePeriodsSpy } =
        setupHandlers();

      const result = await handler.onAssetHistoricalPrice({
        from: USDC_CLASSIC,
        to: 'swift:0/iso4217:USD',
      });

      expect(getHistoricalPriceWithAllTimePeriodsSpy).toHaveBeenCalledWith(
        USDC_CLASSIC,
        'swift:0/iso4217:USD',
      );

      expect(result).toMatchObject({
        historicalPrice: {
          intervals: {},
        },
      });
    });
  });
});
