import type { Json } from '@metamask/utils';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type {
  TransactionScanEstimatedChanges,
  TransactionScanResult,
  TransactionScanService,
} from '../../../services/transaction-scan';
import { TransactionScanOption } from '../../../services/transaction-scan';
import type { ContextWithSecurityScan } from '../../../ui/confirmation/api';
import {
  ConfirmationInterfaceKey,
  ContextWithSecurityScanStruct,
  FetchStatus,
} from '../../../ui/confirmation/api';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';

type SecurityScanContext = ConfirmationDataContext & ContextWithSecurityScan;

/**
 * Refreshes the Blockaid scan in the confirmation dialog context.
 */
export class ConfirmationScanRefresher implements IConfirmationContextRefresher {
  readonly key = ConfirmationContextRefresherKey.Scan;

  readonly #transactionScanService: TransactionScanService;

  readonly #logger: ILogger;

  constructor({
    logger,
    transactionScanService,
  }: {
    logger: ILogger;
    transactionScanService: TransactionScanService;
  }) {
    this.#transactionScanService = transactionScanService;
    this.#logger = createPrefixedLogger(
      logger,
      '[🔄 ConfirmationScanRefresher]',
    );
  }

  shouldFetch(ctx: ConfirmationDataContext): boolean {
    const scanCtx = ctx as SecurityScanContext;
    if (scanCtx.scanFetchStatus === FetchStatus.Error) {
      return false;
    }
    if (!scanCtx.securityScanRequest) {
      return false;
    }
    return this.#getScanOptions(scanCtx).length > 0;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    const scanCtx = ctx as SecurityScanContext;
    if (scanCtx.scanFetchStatus !== FetchStatus.Fetching) {
      return null;
    }
    const optionsEnabled = this.#getScanOptions(scanCtx).length > 0;
    return {
      result: {
        // Keep any locally-seeded estimate visible if the remote scan cannot recover.
        scan: scanCtx.scan ?? null,
        scanFetchStatus: optionsEnabled
          ? FetchStatus.Error
          : FetchStatus.Fetched,
      },
      reschedule: false,
    };
  }

  async refresh(
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    const scanCtx = ctx as SecurityScanContext;
    const scanRequest = scanCtx.securityScanRequest as NonNullable<
      SecurityScanContext['securityScanRequest']
    >;
    const options = this.#getScanOptions(scanCtx);
    const fallbackEstimatedChanges = scanCtx.scan?.estimatedChanges ?? {
      assets: [],
    };

    try {
      const scan = await this.#transactionScanService.scanTransaction({
        ...scanRequest,
        options,
      });

      return {
        result: {
          scan: this.#scanWithEstimatedChangesFallback(
            scan,
            fallbackEstimatedChanges,
          ),
          scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
        },
        reschedule: scan !== null,
      };
    } catch (error) {
      this.#logger.error('Error refreshing confirmation security scan:', error);
      return {
        result: {
          scan: this.#scanWithEstimatedChangesFallback(
            null,
            fallbackEstimatedChanges,
          ),
          scanFetchStatus: FetchStatus.Error,
        },
        reschedule: false,
      };
    }
  }

  isValidContext(ctx: Record<string, Json>): boolean {
    return ContextWithSecurityScanStruct.is(ctx);
  }

  /**
   * Merges a Blockaid scan result with the locally-seeded estimated changes.
   * Remote estimated changes are preferred when Blockaid returns displayable
   * asset rows; otherwise the locally-derived fallback stays on screen.
   *
   * @param scan - The Blockaid scan result, or null when none was returned.
   * @param fallbackEstimatedChanges - The locally-seeded estimated changes.
   * @returns A scan result carrying the best available estimated changes.
   */
  #scanWithEstimatedChangesFallback(
    scan: TransactionScanResult | null,
    fallbackEstimatedChanges: TransactionScanEstimatedChanges,
  ): TransactionScanResult {
    if (scan) {
      const estimatedChanges = this.#hasEstimatedChanges(scan.estimatedChanges)
        ? scan.estimatedChanges
        : fallbackEstimatedChanges;

      return { ...scan, estimatedChanges };
    }
    return {
      status: 'ERROR',
      estimatedChanges: fallbackEstimatedChanges,
      validation: null,
      error: null,
    };
  }

  #hasEstimatedChanges(
    estimatedChanges: TransactionScanEstimatedChanges,
  ): boolean {
    return estimatedChanges.assets.length > 0;
  }

  #getScanOptions(ctx: SecurityScanContext): TransactionScanOption[] {
    const options: TransactionScanOption[] = [];

    if (
      ctx.preferences.simulateOnChainActions &&
      (ctx.interfaceKey === ConfirmationInterfaceKey.SignTransaction ||
        ctx.interfaceKey === ConfirmationInterfaceKey.ConfirmSendTransaction)
    ) {
      options.push(TransactionScanOption.Simulation);
    }

    if (ctx.preferences.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }

    return options;
  }
}
