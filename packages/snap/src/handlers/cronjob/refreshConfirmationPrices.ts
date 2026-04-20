import {
  BackgroundEventMethod,
  ConfirmationInterfaceKey,
  RefreshConfirmationPricesJsonRpcRequestStruct,
} from './api';
import type {
  RefreshConfirmationPricesJsonRpcRequest,
  RefreshConfirmationPricesParams,
} from './api';
import { CronjobBaseHandler } from './base';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import type { PriceService } from '../../services/price';
import type { ContextWithPrices } from '../../ui/confirmation/api';
import { FetchStatus } from '../../ui/confirmation/api';
import { refreshConfirmationPrices as refreshConfirmationPricesChangeTrustlineOptIn } from '../../ui/confirmation/views/ConfirmSignChangeTrustOptIn/render';
import { refreshConfirmationPrices as refreshConfirmationPricesChangeTrustlineOptOut } from '../../ui/confirmation/views/ConfirmSignChangeTrustOptOut/render';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../utils/snap';

export class RefreshConfirmationPricesHandler extends CronjobBaseHandler<RefreshConfirmationPricesJsonRpcRequest> {
  readonly #priceService: PriceService;

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

  constructor({
    logger,
    priceService,
  }: {
    logger: ILogger;
    priceService: PriceService;
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
  }

  async handleCronJobRequest(
    request: RefreshConfirmationPricesJsonRpcRequest,
  ): Promise<void> {
    this.logger.info('Refreshing confirmation prices...');
    const { interfaceId, scope, interfaceKey } = request.params;

    const interfaceContext =
      await getInterfaceContextIfExists<ContextWithPrices>(interfaceId);
    if (!interfaceContext) {
      this.logger.info('Interface no longer exists, cleaning up');
      return;
    }

    try {
      const uniqueAssetCaipIds: KnownCaip19AssetIdOrSlip44Id[] = [
        ...Object.keys(interfaceContext.tokenPrices),
      ] as KnownCaip19AssetIdOrSlip44Id[];

      const prices = await this.#priceService.getSpotPrices({
        assetIds: uniqueAssetCaipIds,
        vsCurrency: interfaceContext.currency,
      });

      const latestContext =
        await getInterfaceContextIfExists<ContextWithPrices>(interfaceId);
      if (!latestContext) {
        this.logger.info('Interface dismissed during price fetch, cleaning up');
        return;
      }

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

      const updatedContext: ContextWithPrices = {
        ...latestContext,
        tokenPrices: updatedTokenPrices,
        tokenPricesFetchStatus: FetchStatus.Fetched,
      };

      await this.#reRenderConfirmationPrices({
        interfaceId,
        updatedContext,
        interfaceKey,
      });

      await RefreshConfirmationPricesHandler.scheduleBackgroundEvent({
        scope,
        interfaceId,
        interfaceKey,
      });
    } catch (error) {
      this.logger.error('Error refreshing confirmation prices:', error);

      const currentContext =
        await getInterfaceContextIfExists<ContextWithPrices>(interfaceId);
      if (currentContext) {
        const errorContext: ContextWithPrices = {
          ...currentContext,
          tokenPricesFetchStatus: FetchStatus.Error,
        };

        await this.#reRenderConfirmationPrices({
          interfaceId,
          updatedContext: errorContext,
          interfaceKey,
        });
      }
    }
  }

  async #reRenderConfirmationPrices(params: {
    interfaceId: string;
    updatedContext: ContextWithPrices;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<void> {
    const { interfaceId, interfaceKey, updatedContext } = params;
    const render =
      interfaceKey === ConfirmationInterfaceKey.ChangeTrustlineOptIn
        ? refreshConfirmationPricesChangeTrustlineOptIn
        : refreshConfirmationPricesChangeTrustlineOptOut;

    await render({
      interfaceId,
      updatedContext,
    });
  }
}
