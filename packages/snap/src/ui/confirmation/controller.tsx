import type { DialogResult } from '@metamask/snaps-sdk';

import { FetchStatus } from './api';
import type { ConfirmationInterfaceKey, ContextWithPrices } from './api';
import {
  formatFeeData,
  formatOrigin,
  getPreferencesWithFallback,
} from './utils';
import type { KnownCaip2ChainId } from '../../api';
import { METAMASK_ORIGIN } from '../../constants';
import type {
  ChangeTrustOptJsonRpcRequest,
  ConfirmSendJsonRpcRequest,
} from '../../handlers/clientRequest/api';
import type {
  SecurityScanRequest,
  TransactionScanResult,
} from '../../services/transaction-scan';
import type { Locale } from '../../utils';
import {
  createInterface,
  Duration,
  getSlip44AssetId,
  showDialog,
  StellarSnapException,
  updateInterfaceIfExists,
} from '../../utils';
import { xlmIcon } from '../images';
import { renderConfirmationView } from './views/render';
import type { ConfirmationViewProps } from './views/render';
import {
  ConfirmationContextRefresherKey,
  RefreshConfirmationContextHandler,
} from '../../handlers/cronjob/refreshConfirmationContext';

type ConfirmationRenderOptions = {
  // Fetch external token spot prices.
  loadPrice?: boolean;
  // Remote Blockaid validation (security alerts).
  securityScanning?: boolean;
  // Local on-chain simulation: estimated changes + per-cycle re-validation
  // (send / change-trust).
  localSimulation?: boolean;
  // Remote Blockaid simulation for estimated changes (sign-transaction).
  remoteSimulation?: boolean;
};

/**
 * Context needed to re-validate the pending transaction against latest on-chain
 * state while the confirmation dialog is open.
 */
type TransactionValidationRequest = {
  accountId: string;
  transaction: string;
  request: ConfirmSendJsonRpcRequest | ChangeTrustOptJsonRpcRequest;
};

/** Common params accepted by every {@link ConfirmationUXController.renderConfirmationDialog} call. */
type RenderConfirmationDialogCommon<Props extends ConfirmationViewProps> = {
  scope: KnownCaip2ChainId;
  renderContext: Props;
  origin?: string;
  renderOptions?: ConfirmationRenderOptions;
  securityScanRequest?: Omit<SecurityScanRequest, 'origin' | 'scope'>;
  transactionValidationRequest?: TransactionValidationRequest;
  tokenPrices?: ContextWithPrices['tokenPrices'];
  /**
   * Seeds the initial scan result so locally-derived data (e.g. estimated
   * balance changes from on-chain simulation) renders immediately on dialog
   * open, before any remote security scan completes.
   */
  initialScan?: TransactionScanResult;
};

type ConfirmationDialogWithFee =
  | ConfirmationInterfaceKey.SignTransaction
  | ConfirmationInterfaceKey.ChangeTrustlineOptIn
  | ConfirmationInterfaceKey.ChangeTrustlineOptOut
  | ConfirmationInterfaceKey.ConfirmSendTransaction;
/**
 * Discriminated union: confirmations that have a fee (example: sign transaction)
 * MUST provide one; fee-less confirmations (sign message, etc.) MUST NOT.
 * Prevents callers from forgetting `fee` for SignTransaction (would yield
 * `feeData: {}` and crash the view at `feeData.assetId`).
 */
type RenderConfirmationDialogParams<Props extends ConfirmationViewProps> =
  | (RenderConfirmationDialogCommon<Props> & {
      interfaceKey: ConfirmationDialogWithFee;
      fee: string;
    })
  | (RenderConfirmationDialogCommon<Props> & {
      interfaceKey: Exclude<
        ConfirmationInterfaceKey,
        ConfirmationDialogWithFee
      >;
      fee?: never;
    });

export class ConfirmationUXController {
  readonly #defaultRenderOptions: ConfirmationRenderOptions = {
    loadPrice: false,
    securityScanning: false,
    localSimulation: false,
    remoteSimulation: false,
  };

  /**
   * Renders the confirmation dialog.
   *
   * @param params - The parameters for the render.
   * @param params.scope - The scope of the confirmation.
   * @param params.renderContext - The context for the render.
   * @param params.interfaceKey - The key of the interface to render.
   * @param params.fee - Fee in stroops, REQUIRED for SignTransaction, forbidden otherwise.
   * @param params.origin - [Optional] The origin of the confirmation. Defaults to METAMASK_ORIGIN.
   * @param params.renderOptions - [Optional] The options for the render. Defaults to {@link #defaultRenderOptions}.
   * @param params.tokenPrices - [Optional] The token prices for the render {@link ContextWithPrices['tokenPrices']}.
   * @returns A promise that resolves to the dialog result.
   */
  async renderConfirmationDialog<Props extends ConfirmationViewProps>(
    params: RenderConfirmationDialogParams<Props>,
  ): Promise<DialogResult> {
    const {
      interfaceKey,
      scope,
      renderContext,
      origin = METAMASK_ORIGIN,
      fee,
    } = params;
    const renderOptions = {
      ...this.#defaultRenderOptions,
      ...params.renderOptions,
    };

    if (
      (renderOptions.securityScanning || renderOptions.remoteSimulation) &&
      params.securityScanRequest === undefined
    ) {
      throw new StellarSnapException(
        'Cannot scan a transaction confirmation without a security scan request.',
      );
    }

    if (
      renderOptions.localSimulation &&
      params.transactionValidationRequest === undefined
    ) {
      throw new StellarSnapException(
        'Cannot run local simulation on a transaction confirmation without a transaction validation request.',
      );
    }

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
     * Enable Price Fetching if:
     * - Pricing Loading is enabled
     * - External Pricing Preferences is enabled
     * - Token Prices mapping is provided
     */
    const enablePricing =
      renderOptions.loadPrice &&
      preferences.useExternalPricingData &&
      tokenPrices !== undefined;

    // Remote Blockaid scan runs when either remote source is both requested by
    // the flow and enabled by the user: validation (security alerts) or
    // simulation (on-chain action simulation).
    const wantsRemoteValidation =
      Boolean(renderOptions.securityScanning) && preferences.useSecurityAlerts;
    const wantsRemoteSimulation =
      Boolean(renderOptions.remoteSimulation) &&
      preferences.simulateOnChainActions;
    const enableSecurityScan =
      params.securityScanRequest !== undefined &&
      (wantsRemoteValidation || wantsRemoteSimulation);

    // Local simulation (estimated changes + per-cycle submittability
    // re-validation) is driven by the Transaction refresher.
    const enableLocalSimulation =
      renderOptions.localSimulation &&
      params.transactionValidationRequest !== undefined;

    const defaultContext = {
      // Persisted so shared event handlers (malicious acknowledgement screen)
      // can re-render the correct confirmation view.
      interfaceKey,
      // if pricing is disabled, mark as fetched immediately
      tokenPricesFetchStatus: enablePricing
        ? FetchStatus.Fetching
        : FetchStatus.Fetched,
      preferences,
      locale: preferences.locale as Locale,
      networkImage: xlmIcon,
      origin: formatOrigin(origin),
      currency: preferences.currency,
      scope,
      feeData: fee ? formatFeeData(scope, fee) : {},
      scan: params.initialScan ?? null,
      scanFetchStatus: enableSecurityScan
        ? FetchStatus.Fetching
        : FetchStatus.Fetched,
      ...(enableSecurityScan
        ? {
            securityScanRequest: {
              ...params.securityScanRequest,
              origin,
              scope,
            },
            // Persist the flow's scan intents so the refresher picks Blockaid
            // options without keying off the interface key.
            securityScanning: Boolean(renderOptions.securityScanning),
            remoteSimulation: Boolean(renderOptions.remoteSimulation),
          }
        : {}),
      // Optimistic: tx was validated at build time, so keep confirm enabled; the
      // refresher flips to Error if it later drifts (submission rejects invalid txs too).
      // TODO(follow-up): re-validate synchronously right before signing.
      ...(enableLocalSimulation && params.transactionValidationRequest
        ? {
            transactionsFetchStatus: FetchStatus.Fetched,
            accountId: params.transactionValidationRequest.accountId,
            transaction: params.transactionValidationRequest.transaction,
            request: params.transactionValidationRequest.request,
          }
        : {}),
      tokenPrices,
    };

    // 1. Initial context with loading state
    const context = {
      ...defaultContext,
      ...renderContext,
    };

    // 2. Initial render with loading skeleton (always show loading if pricing enabled)
    const id = await createInterface(
      renderConfirmationView(interfaceKey, context),
      {},
    );
    const dialogPromise = showDialog(id);

    // 3. Update interface context after initial render (silently ignores if dismissed)
    const updated = await updateInterfaceIfExists(
      id,
      renderConfirmationView(interfaceKey, context),
      context,
    );

    // If interface was dismissed during scan, exit early
    if (!updated) {
      return dialogPromise;
    }

    // 5. Schedule background context refresh for enabled refreshers only
    const refresherKeys: ConfirmationContextRefresherKey[] = [];
    if (enablePricing) {
      refresherKeys.push(ConfirmationContextRefresherKey.Prices);
    }
    if (enableSecurityScan) {
      refresherKeys.push(ConfirmationContextRefresherKey.Scan);
    }
    if (enableLocalSimulation) {
      refresherKeys.push(ConfirmationContextRefresherKey.Transaction);
    }

    if (refresherKeys.length > 0) {
      await RefreshConfirmationContextHandler.scheduleBackgroundEvent(
        {
          scope,
          interfaceId: id,
          interfaceKey,
          refresherKeys,
        },
        Duration.OneSecond,
      );
    }

    // 6. Return the dialog promise immediately (don't await it!)
    // Cleanup happens in the background refresh handler when it detects the interface is gone
    return dialogPromise;
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
      renderConfirmationView(interfaceKey, updatedContext),
      updatedContext,
    );
  }
}
