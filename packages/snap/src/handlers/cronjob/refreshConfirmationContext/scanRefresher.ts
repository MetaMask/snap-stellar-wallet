import type { Json } from '@metamask/utils';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { TransactionScanService } from '../../../services/transaction-scan';
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
 * Refreshes Blockaid security scan / simulation results in the confirmation dialog context.
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
        scan: null,
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

    try {
      const scan = await this.#transactionScanService.scanTransactionSafe({
        ...scanRequest,
        options,
      });

      return {
        result: {
          scan,
          scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
        },
        reschedule: scan !== null,
      };
    } catch (error) {
      this.#logger.error('Error refreshing confirmation security scan:', error);
      return {
        result: {
          scan: null,
          scanFetchStatus: FetchStatus.Error,
        },
        reschedule: false,
      };
    }
  }

  isValidContext(ctx: Record<string, Json>): boolean {
    return ContextWithSecurityScanStruct.is(ctx);
  }

  #getScanOptions(ctx: SecurityScanContext): TransactionScanOption[] {
    const options: TransactionScanOption[] = [];

    // Remote simulation is only used where there is no local re-validation to
    // cover submittability — the dapp sign-transaction flow. Send and
    // change-trust rely on local re-validation, so we skip remote simulation
    // (it proved unreliable on TRON).
    if (
      ctx.preferences.simulateOnChainActions &&
      ctx.interfaceKey === ConfirmationInterfaceKey.SignTransaction
    ) {
      options.push(TransactionScanOption.Simulation);
    }

    if (ctx.preferences.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }

    return options;
  }
}
