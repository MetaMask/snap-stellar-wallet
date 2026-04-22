import type { ComponentOrElement, DialogResult } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';

import {
  ConfirmationInterfaceKey,
  type ContextWithPrices,
  FetchStatus,
} from './api';
import {
  formatFeeData,
  formatOrigin,
  getPreferencesWithFallback,
} from './utils';
import type { KnownCaip2ChainId } from '../../api';
import type { ILogger, Locale } from '../../utils';
import {
  createInterface,
  createPrefixedLogger,
  getSlip44AssetId,
  scheduleBackgroundEvent,
  showDialog,
  updateInterfaceIfExists,
} from '../../utils';
import { STELLAR_IMAGE } from '../images/icon';
import {
  ConfirmSignMessage,
  type ConfirmSignMessageProps,
} from './views/ConfirmSignMessage/ConfirmSignMessage';
import {
  ConfirmSignTransaction,
  type ConfirmSignTransactionProps,
} from './views/ConfirmSignTransaction/ConfirmSignTransaction';
import { BackgroundEventMethod } from '../../handlers/cronjob/api';

/** Serializable props bag stored on the interface and merged into each view. */
type ConfirmationViewProps = Record<string, Json>;

type ConfirmationRenderOptions = {
  loadPrice?: boolean;
  scanTxn?: boolean;
};

export class ConfirmationUXController {
  readonly #logger: ILogger;

  readonly #defaultRenderOptions: ConfirmationRenderOptions = {
    loadPrice: false,
    scanTxn: false,
  };

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(
      logger,
      '[💬 ConfirmationUXController]',
    );
  }

  /**
   * Renders the confirmation dialog.
   *
   * @param params - The parameters for the render.
   * @param params.scope - The scope of the confirmation.
   * @param params.renderContext - The context for the render.
   * @param params.interfaceKey - The key of the interface to render.
   * @param params.fee - [Optional] The fee for the render.
   * @param params.origin - [Optional] The origin of the confirmation. Defaults to 'metamask'.
   * @param params.renderOptions - [Optional] The options for the render. Defaults to {@link #defaultRenderOptions}.
   * @param params.tokenPrices - [Optional] The token prices for the render {@link ContextWithPrices['tokenPrices']}.
   * @returns A promise that resolves to the dialog result.
   */
  async renderConfirmationDialog<Props extends ConfirmationViewProps>(params: {
    scope: KnownCaip2ChainId;
    renderContext: Props;
    interfaceKey: ConfirmationInterfaceKey;
    fee?: string;
    origin?: string;
    renderOptions?: ConfirmationRenderOptions;
    tokenPrices?: ContextWithPrices['tokenPrices'];
  }): Promise<DialogResult> {
    try {
      const {
        interfaceKey,
        scope,
        renderContext,
        origin = 'metamask',
        fee,
        renderOptions = {
          ...this.#defaultRenderOptions,
          ...params.renderOptions,
        },
      } = params;

      const preferences = await getPreferencesWithFallback();

      const defaultTokenPrices = fee
        ? ({
            [getSlip44AssetId(scope)]: null,
          } as ContextWithPrices['tokenPrices'])
        : {};

      const tokenPrices = {
        ...defaultTokenPrices,
        ...params.tokenPrices,
      };

      /**
       * Enazble Price Fetching if:
       * - Pricing Loading is enabled
       * - External Pricing Preferences is enabled
       * - Token Prices mapping is provided
       */
      const enablePricing =
        renderOptions.loadPrice &&
        preferences.useExternalPricingData &&
        tokenPrices !== undefined;

      const defaultContext = {
        // if pricing is disabled, mark as fetched immediately
        tokenPricesFetchStatus: enablePricing
          ? FetchStatus.Fetching
          : FetchStatus.Fetched,
        preferences,
        locale: preferences.locale as Locale,
        networkImage: STELLAR_IMAGE,
        origin: formatOrigin(origin),
        currency: preferences.currency,
        scope,
        feeData: fee ? formatFeeData(scope, fee) : {},
        tokenPrices,
      };

      // 1. Initial context with loading state
      const context = {
        ...defaultContext,
        ...renderContext,
      };

      // 2. Initial render with loading skeleton (always show loading if pricing enabled)
      const id = await createInterface(
        this.#renderConfirmationView(interfaceKey, context),
        {},
      );
      const dialogPromise = showDialog(id);

      // 3. TODO: Perform security scan (always needed for estimated changes simulation)

      // 4. Update interface with scan results after initial render (silently ignores if dismissed)
      const updated = await updateInterfaceIfExists(
        id,
        this.#renderConfirmationView(interfaceKey, context),
        context,
      );

      // If interface was dismissed during scan, exit early
      if (!updated) {
        return dialogPromise;
      }

      // 5. Schedule background jobs only after confirming the interface is still alive
      if (enablePricing) {
        // Trigger immediate price fetch (1 second), then continue every 20 seconds
        await scheduleBackgroundEvent({
          method: BackgroundEventMethod.RefreshConfirmationPrices,
          duration: 'PT1S', // Start immediately
          params: {
            scope,
            interfaceId: id,
            interfaceKey,
          },
        });
      }

      // TODO: Schedule security scan background refresh (every 20 seconds)

      // 6. Return the dialog promise immediately (don't await it!)
      // Cleanup happens in the background refresh handler when it detects the interface is gone
      return dialogPromise;
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Error rendering confirmation dialog',
        error,
      );
      throw error;
    }
  }

  /**
   * Updates the confirmation dialog with the new context.
   *
   * @param params - The parameters for the update.
   * @param params.interfaceId - The ID of the interface to update.
   * @param params.updatedContext - The new context to update the interface with.
   * @param params.interfaceKey - The key of the interface to update.
   */
  async updateConfirmation(params: {
    interfaceId: string;
    updatedContext: ConfirmationViewProps;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<void> {
    const { interfaceId, updatedContext, interfaceKey } = params;
    await updateInterfaceIfExists(
      interfaceId,
      this.#renderConfirmationView(interfaceKey, updatedContext),
      updatedContext,
    );
  }

  #renderConfirmationView(
    interfaceKey: ConfirmationInterfaceKey,
    context: ConfirmationViewProps,
  ): ComponentOrElement {
    switch (interfaceKey) {
      case ConfirmationInterfaceKey.ChangeTrustlineOptIn:
        throw new Error('ChangeTrustlineOptIn is not supported');
      case ConfirmationInterfaceKey.ChangeTrustlineOptOut:
        throw new Error('ChangeTrustlineOptOut is not supported');
      case ConfirmationInterfaceKey.SignTransaction:
        return (
          <ConfirmSignTransaction
            {...(context as unknown as ConfirmSignTransactionProps)}
          />
        );
      case ConfirmationInterfaceKey.SignMessage:
        return <ConfirmSignMessage {...(context as ConfirmSignMessageProps)} />;
      default: {
        const exhaustive: never = interfaceKey;
        throw new Error(`Unsupported interface key: ${String(exhaustive)}`);
      }
    }
  }
}
