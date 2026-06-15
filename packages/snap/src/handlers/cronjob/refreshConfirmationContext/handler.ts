import type { Json } from '@metamask/utils';

import { ConfirmationContextRefresherKey } from './api';
import type {
  ConfirmationContextRefreshResult,
  ConfirmationContextRefreshers,
  ConfirmationDataContext,
  IConfirmationContextRefresher,
} from './api';
import type { ConfirmationInterfaceKey } from '../../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../../ui/confirmation/controller';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';
import {
  Duration,
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../../utils/snap';
import type {
  RefreshConfirmationContextJsonRpcRequest,
  RefreshConfirmationContextParams,
} from '../api';
import {
  BackgroundEventMethod,
  RefreshConfirmationContextJsonRpcRequestStruct,
} from '../api';
import { CronjobBaseHandler } from '../base';

/**
 * Single writer for the confirmation interface context. Orchestrates
 * composed refreshers;
 *
 * The {@link ConfirmationUXController} passes {@link RefreshConfirmationContextParams.refresherKeys} to select which refreshers run per
 * cycle. Unlisted keys are not validated or executed.
 */
export class RefreshConfirmationContextHandler extends CronjobBaseHandler<RefreshConfirmationContextJsonRpcRequest> {
  readonly #refresherByKey: Map<
    ConfirmationContextRefresherKey,
    IConfirmationContextRefresher
  >;

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
    confirmationUIController,
    refreshers,
  }: {
    logger: ILogger;
    confirmationUIController: ConfirmationUXController;
    refreshers: ConfirmationContextRefreshers;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[🔄 RefreshConfirmationContextHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: RefreshConfirmationContextJsonRpcRequestStruct,
    });
    this.#refresherByKey = new Map(
      refreshers.map((refresher) => [refresher.key, refresher]),
    );
    // A safeguard to ensure all refreshers are registered.
    if (this.#refresherByKey.size !== refreshers.length) {
      throw new Error(
        'Duplicate confirmation context refresher key registered',
      );
    }
    this.#confirmationUIController = confirmationUIController;
  }

  /**
   * Handles the refresh confirmation context cron job request.
   *
   * @param request - The refresh confirmation context JSON-RPC request.
   */
  protected async handleCronJobRequest(
    request: RefreshConfirmationContextJsonRpcRequest,
  ): Promise<void> {
    this.logger.info('Refreshing confirmation context...');
    const { interfaceId, scope, interfaceKey, refresherKeys } = request.params;

    const activeRefreshers = this.#resolveRefreshers(refresherKeys);
    if (activeRefreshers.length === 0) {
      this.logger.warn('No matching refreshers for requested keys, skipping');
      return;
    }

    const interfaceContext = await this.#getInterfaceContextIfExists({
      interfaceId,
      activeRefreshers,
    });
    if (interfaceContext === null) {
      return;
    }

    const results = await this.#runRefreshers(
      interfaceContext,
      activeRefreshers,
    );

    if (results.every((result) => result === null)) {
      this.logger.info(
        'No data sources to refresh or recover; cron will not be rescheduled',
      );
      return;
    }

    const latestContext = await this.#getInterfaceContextIfExists({
      interfaceId,
      activeRefreshers,
    });
    if (latestContext === null) {
      return;
    }

    const refresherPatches = results.reduce<Record<string, Json>>(
      (acc, result) => ({ ...acc, ...(result?.result ?? {}) }),
      {},
    );

    const updatedContext: ConfirmationDataContext = {
      ...latestContext,
      ...refresherPatches,
    };

    await this.#reRender({
      interfaceId,
      interfaceKey,
      updatedContext,
    });

    if (results.some((result) => result?.reschedule)) {
      await RefreshConfirmationContextHandler.scheduleBackgroundEvent({
        scope,
        interfaceId,
        interfaceKey,
        refresherKeys,
      });
    }
  }

  #resolveRefreshers(
    keys: ConfirmationContextRefresherKey[],
  ): IConfirmationContextRefresher[] {
    const resolvedRefreshers: IConfirmationContextRefresher[] = [];

    for (const key of keys) {
      const refresher = this.#refresherByKey.get(key);
      if (refresher) {
        resolvedRefreshers.push(refresher);
      } else {
        this.logger.warn(`Unknown confirmation context refresher key: ${key}`);
      }
    }

    return resolvedRefreshers;
  }

  /**
   * Runs enabled refreshers for one cycle.
   *
   * The transaction refresher runs first and in isolation: it rebuilds the
   * pending transaction with a fresh time bound and writes it into the
   * security-scan request. Its patch is merged into the context the remaining
   * refreshers see, so the scan refresher simulates/validates the renewed
   * envelope rather than a (possibly expired) snapshot. The remaining refreshers
   * then run in parallel.
   *
   * Each refresher is isolated so one rejection does not prevent the others from
   * completing.
   *
   * @param ctx - Confirmation interface context passed to each refresher.
   * @param activeRefreshers - Refreshers selected by `refresherKeys`.
   * @returns One result per active refresher; rejected refreshers become `null`.
   */
  async #runRefreshers(
    ctx: ConfirmationDataContext,
    activeRefreshers: readonly IConfirmationContextRefresher[],
  ): Promise<ConfirmationContextRefreshResult[]> {
    const transactionRefresher = activeRefreshers.find(
      (refresher) =>
        refresher.key === ConfirmationContextRefresherKey.Transaction,
    );
    const remainingRefreshers = activeRefreshers.filter(
      (refresher) => refresher !== transactionRefresher,
    );

    const results: ConfirmationContextRefreshResult[] = [];
    let workingContext = ctx;

    if (transactionRefresher) {
      const transactionResult = await this.#settleRefresher(
        transactionRefresher,
        workingContext,
      );
      results.push(transactionResult);
      if (transactionResult?.result) {
        workingContext = { ...workingContext, ...transactionResult.result };
      }
    }

    const remainingResults = await Promise.all(
      remainingRefreshers.map(async (refresher) =>
        this.#settleRefresher(refresher, workingContext),
      ),
    );

    return [...results, ...remainingResults];
  }

  /**
   * Runs a single refresher and converts an unexpected rejection into `null`,
   * so a failing refresher never blocks the others.
   *
   * @param refresher - The refresher to run.
   * @param ctx - The context passed to the refresher.
   * @returns The refresher result, or `null` when it rejected.
   */
  async #settleRefresher(
    refresher: IConfirmationContextRefresher,
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    try {
      return await this.#runRefresher(refresher, ctx);
    } catch (error) {
      this.logger.error(
        `Refresher "${refresher.key}" rejected unexpectedly`,
        error,
      );
      return null;
    }
  }

  async #runRefresher(
    refresher: IConfirmationContextRefresher,
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    // If the refresher decides there is nothing to fetch right now
    // (for example, no eligible assets remain or a prior error state
    // means refresh should be skipped), use the recovery result to clear
    // any stuck loading state.
    if (!refresher.shouldFetch(ctx)) {
      return refresher.recoveryResult(ctx);
    }

    return refresher.refresh(ctx);
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
    activeRefreshers: readonly IConfirmationContextRefresher[];
  }): Promise<ConfirmationDataContext | null> {
    const { interfaceId, activeRefreshers } = params;
    const interfaceContext =
      await getInterfaceContextIfExists<ConfirmationDataContext>(interfaceId);

    if (!interfaceContext) {
      this.logger.info('Interface no longer exists, cleaning up');
      return null;
    }

    if (!isRecord(interfaceContext)) {
      this.logger.warn('Interface context is not an object, skipping refresh');
      return null;
    }

    if (
      activeRefreshers.some(
        (refresher) => !refresher.isValidContext(interfaceContext),
      )
    ) {
      this.logger.warn(
        'Interface context does not match an enabled refresher shape, skipping refresh',
      );
      return null;
    }

    return interfaceContext;
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
