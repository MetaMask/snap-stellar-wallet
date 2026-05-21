import type { Json } from '@metamask/utils';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../../api';
import type { PriceService } from '../../../services/price';
import type { ContextWithPrices } from '../../../ui/confirmation/api';
import {
  ContextWithPricesStruct,
  FetchStatus,
} from '../../../ui/confirmation/api';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';

/**
 * Refreshes token spot prices in the confirmation dialog context.
 * Price slice of the confirmation context refresh pipeline;
 */
export class ConfirmationPriceRefresher implements IConfirmationContextRefresher {
  readonly key = ConfirmationContextRefresherKey.Prices;

  readonly #priceService: PriceService;

  readonly #logger: ILogger;

  constructor({
    logger,
    priceService,
  }: {
    logger: ILogger;
    priceService: PriceService;
  }) {
    this.#priceService = priceService;
    this.#logger = createPrefixedLogger(
      logger,
      '[🔄 ConfirmationPriceRefresher]',
    );
  }

  shouldFetch(ctx: ConfirmationDataContext): boolean {
    if (Object.keys(ctx.tokenPrices).length === 0) {
      return false;
    }
    if (ctx.tokenPricesFetchStatus === FetchStatus.Error) {
      return false;
    }
    return true;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    // If we are not in a loading state, there is nothing to fix.
    // We return null so the handler does not change tokenPricesFetchStatus on the dialog.
    if (ctx.tokenPricesFetchStatus !== FetchStatus.Fetching) {
      return null;
    }

    // We set the status to fetched so the loading UI stops, even though we have no new prices.
    return {
      result: { tokenPricesFetchStatus: FetchStatus.Fetched },
      reschedule: false,
    };
  }

  async refresh(
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    try {
      const uniqueAssetCaipIds = [
        ...Object.keys(ctx.tokenPrices),
      ] as KnownCaip19AssetIdOrSlip44Id[];

      const prices = await this.#priceService.getSpotPrices({
        assetIds: uniqueAssetCaipIds,
        vsCurrency: ctx.currency,
      });

      const updatedTokenPrices = uniqueAssetCaipIds.reduce<
        ContextWithPrices['tokenPrices']
      >(
        (acc, assetId) => {
          if (prices[assetId]) {
            acc[assetId] = prices[assetId]?.price.toString() ?? null;
          } else {
            acc[assetId] = null;
          }
          return acc;
        },
        {} as ContextWithPrices['tokenPrices'],
      );

      return {
        result: {
          tokenPrices: updatedTokenPrices,
          tokenPricesFetchStatus: FetchStatus.Fetched,
        },
        reschedule: true,
      };
    } catch (error) {
      this.#logger.error('Error refreshing confirmation prices:', error);
      return {
        result: { tokenPricesFetchStatus: FetchStatus.Error },
        reschedule: false,
      };
    }
  }

  isValidContext(ctx: Record<string, Json>): boolean {
    return ContextWithPricesStruct.is(ctx);
  }
}
