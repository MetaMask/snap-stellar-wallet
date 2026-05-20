import type { Json } from '@metamask/utils';

import {
  BackgroundEventMethod,
  RefreshConfirmationContextJsonRpcRequestStruct,
} from './api';
import type {
  RefreshConfirmationContextJsonRpcRequest,
  RefreshConfirmationContextParams,
} from './api';
import { CronjobBaseHandler } from './base';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import type { PriceService } from '../../services/price';
import type {
  SecurityScanRequest,
  TransactionScanResult,
  TransactionScanService,
} from '../../services/transaction-scan';
import { TransactionScanOption } from '../../services/transaction-scan';
import type {
  ConfirmationInterfaceKey,
  ContextWithPrices,
  ContextWithSecurityScan,
} from '../../ui/confirmation/api';
import {
  ContextWithPricesStruct,
  ContextWithSecurityScanStruct,
  FetchStatus,
} from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  Duration,
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../utils/snap';

/**
 * Combined context shape this handler reads and writes. Every confirmation
 * dialog that opts into background data refresh carries both the price
 * fields and the security-scan fields, so we validate both shapes together.
 */
type ConfirmationDataContext = Record<string, Json> &
  ContextWithPrices &
  ContextWithSecurityScan;

type ScanFetchValue = TransactionScanResult | null | undefined;

type PriceMap = ContextWithPrices['tokenPrices'];

type PriceFetchValue = PriceMap | undefined;

/**
 * Single writer for the confirmation interface context. Fetches every
 * background data source the dialog depends on (today: prices and security
 * scan) in parallel, then performs a single read–modify–write so concurrent
 * fetches can't lose updates to one another.
 *
 * IMPORTANT: Any future "load supplementary data into the confirmation
 * dialog" feature MUST be added to this handler (not as a separate cron
 * entry) to preserve the single-writer invariant on the shared interface
 * context.
 */
export class RefreshConfirmationContextHandler extends CronjobBaseHandler<RefreshConfirmationContextJsonRpcRequest> {
  readonly #priceService: PriceService;

  readonly #transactionScanService: TransactionScanService;

  readonly #confirmationUIController: ConfirmationUXController;

  static async scheduleBackgroundEvent(
    params: RefreshConfirmationContextParams,
    duration: Duration = Duration.TwentySeconds,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params,
      duration,
    });
  }

  constructor({
    logger,
    priceService,
    transactionScanService,
    confirmationUIController,
  }: {
    logger: ILogger;
    priceService: PriceService;
    transactionScanService: TransactionScanService;
    confirmationUIController: ConfirmationUXController;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[🔄 RefreshConfirmationContextHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: RefreshConfirmationContextJsonRpcRequestStruct,
    });
    this.#priceService = priceService;
    this.#transactionScanService = transactionScanService;
    this.#confirmationUIController = confirmationUIController;
  }

  protected async handleCronJobRequest(
    request: RefreshConfirmationContextJsonRpcRequest,
  ): Promise<void> {
    this.logger.info('Refreshing confirmation context...');
    const { interfaceId, scope, interfaceKey } = request.params;

    const ctx = await this.#getInterfaceContextIfExists({
      interfaceId,
      interfaceKey,
    });
    if (ctx === null) {
      return;
    }

    const shouldFetchPrices = this.#shouldFetchPrices(ctx);
    const shouldFetchScan = this.#shouldFetchScan(ctx);

    // Recovery patches for sources we are NOT going to fetch this cycle but
    // whose status is currently mid-flight (`Fetching`). Without this, the
    // dialog could hang in a loading state forever when a source is disabled
    // or its request is missing.
    const priceRecoveryPatch = shouldFetchPrices
      ? null
      : this.#getPriceRecoveryPatch(ctx);
    const scanRecoveryPatch = shouldFetchScan
      ? null
      : this.#getScanRecoveryPatch(ctx);

    const hasFetchWork = shouldFetchPrices || shouldFetchScan;
    const hasRecoveryWork =
      priceRecoveryPatch !== null || scanRecoveryPatch !== null;

    if (!hasFetchWork && !hasRecoveryWork) {
      // Nothing to fetch, nothing to recover. Let the cron die.
      this.logger.info(
        'No data sources to refresh or recover; cron will not be rescheduled',
      );
      return;
    }

    // Pre-update: flip the active fetch sources to Fetching so the dialog
    // shows a loading state for them. Skip when nothing would change (the
    // controller already initializes statuses to Fetching on first cycle).
    // Recovery-only writes are folded into the final write below.
    if (
      hasFetchWork &&
      this.#needsPreFetchingWrite(ctx, shouldFetchPrices, shouldFetchScan)
    ) {
      await this.#reRender({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...ctx,
          ...(shouldFetchPrices
            ? { tokenPricesFetchStatus: FetchStatus.Fetching }
            : {}),
          ...(shouldFetchScan ? { scanFetchStatus: FetchStatus.Fetching } : {}),
        },
      });
    }

    // Parallel fetch. `allSettled` ensures one failure does not abort the other.
    // Inactive sources resolve to `undefined` (no-op).
    const [pricesResult, scanResult] = await Promise.allSettled([
      shouldFetchPrices
        ? this.#fetchPrices(ctx)
        : Promise.resolve<PriceFetchValue>(undefined),
      shouldFetchScan
        ? this.#fetchScan(ctx)
        : Promise.resolve<ScanFetchValue>(undefined),
    ]);

    // Re-read context — the dialog may have been dismissed during the fetch.
    // Single read-modify-write at the end is what eliminates the lost-update race.
    const latest = await this.#getInterfaceContextIfExists({
      interfaceId,
      interfaceKey,
    });
    if (latest === null) {
      return;
    }

    // For each source, apply either the fetched-result patch or its
    // recovery patch (when we did not fetch). Both halves of the final
    // write land in a single `updateConfirmation` call.
    const updatedContext: ConfirmationDataContext = {
      ...latest,
      ...(shouldFetchPrices
        ? this.#buildPricePatch(pricesResult, latest)
        : (priceRecoveryPatch ?? {})),
      ...(shouldFetchScan
        ? this.#buildScanPatch(scanResult)
        : (scanRecoveryPatch ?? {})),
    };

    await this.#reRender({
      interfaceId,
      interfaceKey,
      updatedContext,
    });

    // Reschedule when at least one source ran successfully — otherwise both
    // sources are now terminal (Error) and there is nothing more to refresh.
    const pricesAlive =
      shouldFetchPrices && pricesResult.status === 'fulfilled';
    const scanAlive =
      shouldFetchScan &&
      scanResult.status === 'fulfilled' &&
      scanResult.value !== null;

    if (pricesAlive || scanAlive) {
      await RefreshConfirmationContextHandler.scheduleBackgroundEvent({
        scope,
        interfaceId,
        interfaceKey,
      });
    }
  }

  #shouldFetchPrices(ctx: ConfirmationDataContext): boolean {
    if (Object.keys(ctx.tokenPrices).length === 0) {
      return false;
    }
    if (ctx.tokenPricesFetchStatus === FetchStatus.Error) {
      // Previous cycle ended in terminal error; stop polling for this source.
      return false;
    }
    return true;
  }

  #shouldFetchScan(ctx: ConfirmationDataContext): boolean {
    if (ctx.scanFetchStatus === FetchStatus.Error) {
      return false;
    }
    if (!ctx.securityScanRequest) {
      return false;
    }
    return this.#getScanOptions(ctx.preferences).length > 0;
  }

  #needsPreFetchingWrite(
    ctx: ConfirmationDataContext,
    shouldFetchPrices: boolean,
    shouldFetchScan: boolean,
  ): boolean {
    if (
      shouldFetchPrices &&
      ctx.tokenPricesFetchStatus !== FetchStatus.Fetching
    ) {
      return true;
    }
    if (shouldFetchScan && ctx.scanFetchStatus !== FetchStatus.Fetching) {
      return true;
    }
    return false;
  }

  /**
   * Patch that resolves the price section's UI status when we have decided
   * NOT to fetch prices this cycle but the status is currently mid-flight
   * (`Fetching`). Returns null when no recovery is needed.
   *
   * Today the only reason we skip the price fetch with `Fetching` status is
   * an empty `tokenPrices` map — terminal Error is already non-Fetching, so
   * the guard below filters it out.
   *
   * @param ctx - Current interface context.
   * @returns A partial price patch, or null when no recovery is needed.
   */
  #getPriceRecoveryPatch(
    ctx: ConfirmationDataContext,
  ): Partial<ContextWithPrices> | null {
    if (ctx.tokenPricesFetchStatus !== FetchStatus.Fetching) {
      return null;
    }
    return { tokenPricesFetchStatus: FetchStatus.Fetched };
  }

  /**
   * Patch that resolves the scan section's UI status when we have decided
   * NOT to fetch the scan this cycle but the status is currently mid-flight
   * (`Fetching`). Without this, a missing `securityScanRequest` would leave
   * the dialog stuck in "scan in progress" forever — restoring the previous
   * single-handler behavior.
   *
   * - Options enabled but `securityScanRequest` missing → terminal Error.
   * - Options disabled (no scan needed) → Fetched.
   *
   * @param ctx - Current interface context.
   * @returns A partial scan patch, or null when no recovery is needed.
   */
  #getScanRecoveryPatch(
    ctx: ConfirmationDataContext,
  ): Partial<ContextWithSecurityScan> | null {
    if (ctx.scanFetchStatus !== FetchStatus.Fetching) {
      return null;
    }
    const optionsEnabled = this.#getScanOptions(ctx.preferences).length > 0;
    return {
      scan: null,
      scanFetchStatus: optionsEnabled ? FetchStatus.Error : FetchStatus.Fetched,
    };
  }

  #getScanOptions(
    preferences: ContextWithSecurityScan['preferences'],
  ): TransactionScanOption[] {
    const options: TransactionScanOption[] = [];
    if (preferences.simulateOnChainActions) {
      options.push(TransactionScanOption.Simulation);
    }
    if (preferences.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }
    return options;
  }

  async #fetchPrices(ctx: ConfirmationDataContext): Promise<PriceMap> {
    const assetIds = Object.keys(
      ctx.tokenPrices,
    ) as KnownCaip19AssetIdOrSlip44Id[];

    const prices = await this.#priceService.getSpotPrices({
      assetIds,
      vsCurrency: ctx.currency,
    });

    return assetIds.reduce<PriceMap>((acc, assetId) => {
      acc[assetId] = prices[assetId]?.price.toString() ?? null;
      return acc;
    }, {} as PriceMap);
  }

  async #fetchScan(
    ctx: ConfirmationDataContext,
  ): Promise<TransactionScanResult | null> {
    // #shouldFetchScan already verified the request exists.
    const scanRequest = ctx.securityScanRequest as SecurityScanRequest;
    return this.#transactionScanService.scanTransaction({
      ...scanRequest,
      options: this.#getScanOptions(ctx.preferences),
    });
  }

  #buildPricePatch(
    result: PromiseSettledResult<PriceFetchValue>,
    latest: ConfirmationDataContext,
  ): Partial<ContextWithPrices> {
    if (result.status === 'rejected') {
      this.logger.error('Failed to refresh prices', result.reason);
      return { tokenPricesFetchStatus: FetchStatus.Error };
    }
    return {
      tokenPrices: result.value ?? latest.tokenPrices,
      tokenPricesFetchStatus: FetchStatus.Fetched,
    };
  }

  #buildScanPatch(
    result: PromiseSettledResult<ScanFetchValue>,
  ): Partial<ContextWithSecurityScan> {
    if (result.status === 'rejected') {
      this.logger.error('Failed to refresh security scan', result.reason);
      return { scan: null, scanFetchStatus: FetchStatus.Error };
    }
    const scan = result.value ?? null;
    return {
      scan,
      // A null scan means the service swallowed a network error → terminal Error
      // for this cycle. A non-null scan (including `scan.status === 'ERROR'`
      // from Blockaid) is a delivered result → Fetched.
      scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
    };
  }

  async #reRender(params: {
    interfaceId: string;
    interfaceKey: ConfirmationInterfaceKey;
    updatedContext: Record<string, Json>;
  }): Promise<void> {
    await this.#confirmationUIController.updateConfirmation(params);
  }

  async #getInterfaceContextIfExists(params: {
    interfaceId: string;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<ConfirmationDataContext | null> {
    const { interfaceId, interfaceKey } = params;
    const interfaceContext =
      await getInterfaceContextIfExists<Json>(interfaceId);

    if (!interfaceContext) {
      this.logger.info('Interface no longer exists, cleaning up');
      return null;
    }

    if (!isRecord(interfaceContext)) {
      this.logger.warn('Interface context is not an object, skipping refresh');
      return null;
    }

    if (
      !ContextWithPricesStruct.is(interfaceContext) ||
      !ContextWithSecurityScanStruct.is(interfaceContext)
    ) {
      this.logger.warn(
        'Interface context does not match the confirmation data shape, marking refresh as failed',
      );
      // Recovery: write terminal Error states so the UI doesn't hang in
      // Fetching forever. The malformed fields are spread back unchanged
      // (they were already there); only the status fields are forced.
      await this.#reRender({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...interfaceContext,
          tokenPricesFetchStatus: FetchStatus.Error,
          scan: null,
          scanFetchStatus: FetchStatus.Error,
        },
      });
      return null;
    }

    return interfaceContext as ConfirmationDataContext;
  }
}

/**
 * Checks whether a JSON value is an object record.
 *
 * @param value - The JSON value to check.
 * @returns True when the value is a non-array object.
 */
function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
