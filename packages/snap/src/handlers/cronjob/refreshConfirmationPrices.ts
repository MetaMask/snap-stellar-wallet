import type { Json } from '@metamask/utils';

import {
  BackgroundEventMethod,
  RefreshConfirmationPricesJsonRpcRequestStruct,
} from './api';
import type {
  RefreshConfirmationPricesJsonRpcRequest,
  RefreshConfirmationPricesParams,
} from './api';
import { CronjobBaseHandler } from './base';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import type { PriceService } from '../../services/price';
import type {
  ConfirmationInterfaceKey,
  ContextWithPrices,
} from '../../ui/confirmation/api';
import {
  ContextWithPricesStruct,
  FetchStatus,
} from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../utils/snap';

export class RefreshConfirmationPricesHandler extends CronjobBaseHandler<RefreshConfirmationPricesJsonRpcRequest> {
  readonly #priceService: PriceService;

  // Refresh interval
  static readonly duration = 'PT20S';

  static async scheduleBackgroundEvent(
    params: RefreshConfirmationPricesParams,
    duration: string = RefreshConfirmationPricesHandler.duration,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.RefreshConfirmationPrices,
      params,
      duration,
    });
  }

  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    priceService,
    confirmationUIController,
  }: {
    logger: ILogger;
    priceService: PriceService;
    confirmationUIController: ConfirmationUXController;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[🔄 RefreshConfirmationPricesHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: RefreshConfirmationPricesJsonRpcRequestStruct,
    });
    this.#priceService = priceService;
    this.#confirmationUIController = confirmationUIController;
  }

  /**
   * Handles the refresh confirmation prices cron job request.
   *
   * @param request - The refresh confirmation prices JSON-RPC request.
   */
  async handleCronJobRequest(
    request: RefreshConfirmationPricesJsonRpcRequest,
  ): Promise<void> {
    this.logger.info('Refreshing confirmation prices...');
    const { interfaceId, scope, interfaceKey } = request.params;

    // Find the interface context
    const interfaceContext =
      await this.#getInterfaceContextIfExists(interfaceId);
    if (interfaceContext === null) {
      return;
    }

    try {
      // Extract CAIP IDs from context
      const uniqueAssetCaipIds = [
        ...Object.keys(interfaceContext.tokenPrices),
      ] as KnownCaip19AssetIdOrSlip44Id[];

      // Fetch fresh prices via lazy cache mechanism
      const prices = await this.#priceService.getSpotPrices({
        assetIds: uniqueAssetCaipIds,
        vsCurrency: interfaceContext.currency,
      });

      // Fill the context with the new prices
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

      // Get the latest context, to ensure the interface is still visible after the price fetch
      const latestContext =
        await this.#getInterfaceContextIfExists(interfaceId);
      if (latestContext === null) {
        return;
      }

      // Update the context with the new prices
      const updatedContext: ContextWithPrices = {
        ...latestContext,
        tokenPrices: updatedTokenPrices,
        tokenPricesFetchStatus: FetchStatus.Fetched,
      };

      // Re-render the Component based on the interface key
      await this.#reRenderConfirmationPrices({
        interfaceId,
        updatedContext,
        interfaceKey,
      });

      // Schedule the next background event
      await RefreshConfirmationPricesHandler.scheduleBackgroundEvent({
        scope,
        interfaceId,
        interfaceKey,
      });
    } catch (error) {
      this.logger.error('Error refreshing confirmation prices:', error);

      const currentContext =
        await this.#getInterfaceContextIfExists(interfaceId);
      if (currentContext !== null) {
        // Update the context with the error status
        const errorContext: ContextWithPrices = {
          ...currentContext,
          tokenPricesFetchStatus: FetchStatus.Error,
        };

        await this.#reRenderConfirmationPrices({
          interfaceId,
          updatedContext: errorContext,
          interfaceKey,
        });
        // Don't schedule another refresh on error
      }
    }
  }

  async #reRenderConfirmationPrices(params: {
    interfaceId: string;
    updatedContext: ContextWithPrices;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<void> {
    const { interfaceId, interfaceKey, updatedContext } = params;

    await this.#confirmationUIController.updateConfirmation({
      interfaceId,
      updatedContext,
      interfaceKey,
    });
  }

  async #getInterfaceContextIfExists(
    interfaceId: string,
  ): Promise<ContextWithPrices | null> {
    const interfaceContext =
      await getInterfaceContextIfExists<Json>(interfaceId);

    if (!interfaceContext) {
      this.logger.info('Interface no longer exists, cleaning up');
      return null;
    }

    if (!ContextWithPricesStruct.is(interfaceContext)) {
      this.logger.warn(
        'Interface context does not match the ContextWithPrices interface, skipping refresh',
      );
      return null;
    }

    return interfaceContext;
  }
}
