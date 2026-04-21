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

  async renderConfirmationDialog<Props extends ConfirmationViewProps>(params: {
    scope: KnownCaip2ChainId;
    renderContext: Props;
    fee?: string;
    interfaceKey: ConfirmationInterfaceKey;
    origin?: string;
    renderOptions?: ConfirmationRenderOptions;
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

      const enablePricing =
        renderOptions.loadPrice && preferences.useExternalPricingData;

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
        feeData: fee ? formatFeeData(scope, fee) : undefined,
        tokenPrices: fee
          ? ({
              [getSlip44AssetId(scope)]: null,
            } as ContextWithPrices['tokenPrices'])
          : {},
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

  /**
   * Maps each {@link ConfirmationInterfaceKey} to its view. Casts stay inside this
   * switch so callers keep a single `ConfirmationViewProps` shape for storage/refresh.
   *
   * @param interfaceKey
   * @param context
   */
  #renderConfirmationView(
    interfaceKey: ConfirmationInterfaceKey,
    context: ConfirmationViewProps,
  ): ComponentOrElement {
    switch (interfaceKey) {
      case ConfirmationInterfaceKey.ChangeTrustlineOptIn:
        throw new Error(`Unsupported interface key: ${interfaceKey}`);
      case ConfirmationInterfaceKey.ChangeTrustlineOptOut:
        throw new Error(`Unsupported interface key: ${interfaceKey}`);
      case ConfirmationInterfaceKey.SendTransaction:
        throw new Error(`Unsupported interface key: ${interfaceKey}`);
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
