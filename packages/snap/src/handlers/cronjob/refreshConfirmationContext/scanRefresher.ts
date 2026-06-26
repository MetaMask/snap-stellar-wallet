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
    // Locally-seeded estimated changes (send / change-trust hold the known
    // outgoing amount here). For those flows we never let the remote scan
    // override them; sign-txn has no seed (`{ assets: [] }`) and adopts the
    // remote estimate.
    const localEstimatedChanges = scanCtx.scan?.estimatedChanges ?? {
      assets: [],
    };
    // Only sign-transaction opts into remote simulation, so only it may surface
    // Blockaid's estimated changes. A validation-only scan can still carry
    // simulation diffs in its payload, which must not replace the local seed.
    const preferRemoteEstimatedChanges = Boolean(scanCtx.remoteSimulation);

    try {
      const scan = await this.#transactionScanService.scanTransactionSafe({
        ...scanRequest,
        options,
      });

      return {
        result: {
          scan: this.#resolveEstimatedChanges(
            scan,
            localEstimatedChanges,
            preferRemoteEstimatedChanges,
          ),
          scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
        },
        reschedule: scan !== null,
      };
    } catch (error) {
      this.#logger.error('Error refreshing confirmation security scan:', error);
      return {
        result: {
          scan: this.#resolveEstimatedChanges(
            null,
            localEstimatedChanges,
            preferRemoteEstimatedChanges,
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
   * Resolves which estimated changes a scan result should carry.
   *
   * For remote-simulation flows (sign-transaction) Blockaid's estimated changes
   * win when it returns displayable rows; otherwise the locally-seeded estimate
   * is kept. For local-simulation flows (send / change-trust) the local seed
   * always wins — a validation-only scan must never override it.
   *
   * @param scan - The Blockaid scan result, or null when none was returned.
   * @param localEstimatedChanges - The locally-seeded estimated changes.
   * @param preferRemoteEstimatedChanges - Whether the flow opted into remote simulation.
   * @returns A scan result carrying the resolved estimated changes.
   */
  #resolveEstimatedChanges(
    scan: TransactionScanResult | null,
    localEstimatedChanges: TransactionScanEstimatedChanges,
    preferRemoteEstimatedChanges: boolean,
  ): TransactionScanResult {
    if (scan) {
      const estimatedChanges =
        preferRemoteEstimatedChanges &&
        this.#hasEstimatedChanges(scan.estimatedChanges)
          ? scan.estimatedChanges
          : localEstimatedChanges;

      return { ...scan, estimatedChanges };
    }
    return {
      status: 'ERROR',
      estimatedChanges: localEstimatedChanges,
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

    // Remote simulation is requested only by flows that opted into it (sign
    // transaction) and only when the user enabled on-chain action simulation.
    if (ctx.remoteSimulation && ctx.preferences.simulateOnChainActions) {
      options.push(TransactionScanOption.Simulation);
    }

    if (ctx.securityScanning && ctx.preferences.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }

    return options;
  }
}
