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
  ContextWithSecurityScanStruct,
  FetchStatus,
} from '../../../ui/confirmation/api';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';

type SecurityScanContext = ConfirmationDataContext & ContextWithSecurityScan;

type SecurityScanPreferences = ContextWithSecurityScan['preferences'];

/**
 * Refreshes the Blockaid security validation in the confirmation dialog context.
 *
 * Estimated balance changes are owned by the local on-chain simulation (seeded
 * at dialog open), so this refresher only requests Blockaid `Validation` and
 * never overwrites the locally-derived `estimatedChanges`.
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
    return this.#getScanOptions(scanCtx.preferences).length > 0;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    const scanCtx = ctx as SecurityScanContext;
    if (scanCtx.scanFetchStatus !== FetchStatus.Fetching) {
      return null;
    }
    const optionsEnabled = this.#getScanOptions(scanCtx.preferences).length > 0;
    return {
      result: {
        // Preserve the locally-derived estimated changes; only the scan fetch
        // status reflects the (validation) failure.
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
    const options = this.#getScanOptions(scanCtx.preferences);
    const localEstimatedChanges = scanCtx.scan?.estimatedChanges ?? {
      assets: [],
    };

    try {
      const scan = await this.#transactionScanService.scanTransaction({
        ...scanRequest,
        options,
      });

      return {
        result: {
          // Blockaid only contributes validation/error; the locally-derived
          // estimated changes always take precedence.
          scan: this.#scanWithLocalChanges(scan, localEstimatedChanges),
          scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
        },
        reschedule: scan !== null,
      };
    } catch (error) {
      this.#logger.error('Error refreshing confirmation security scan:', error);
      return {
        result: {
          scan: this.#scanWithLocalChanges(null, localEstimatedChanges),
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
   * Merges a Blockaid scan result with the locally-derived estimated changes,
   * preserving the fund-flow breakdown regardless of the remote scan outcome.
   *
   * @param scan - The Blockaid scan result, or null when none was returned.
   * @param localEstimatedChanges - The estimated changes from local simulation.
   * @returns A scan result carrying the local estimated changes.
   */
  #scanWithLocalChanges(
    scan: TransactionScanResult | null,
    localEstimatedChanges: TransactionScanEstimatedChanges,
  ): TransactionScanResult {
    if (scan) {
      return { ...scan, estimatedChanges: localEstimatedChanges };
    }
    return {
      status: 'ERROR',
      estimatedChanges: localEstimatedChanges,
      validation: null,
      error: null,
    };
  }

  #getScanOptions(
    preferences: SecurityScanPreferences,
  ): TransactionScanOption[] {
    const options: TransactionScanOption[] = [];

    // Remote simulation is intentionally not requested: estimated balance
    // changes are derived from the local on-chain simulation. Blockaid is used
    // for security validation only.
    if (preferences.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }

    return options;
  }
}
