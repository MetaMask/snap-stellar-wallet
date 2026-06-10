import type { Json } from '@metamask/utils';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { TransactionScanService } from '../../../services/transaction-scan';
import type { ContextWithTokenScan } from '../../../ui/confirmation/api';
import {
  ContextWithTokenScanStruct,
  FetchStatus,
} from '../../../ui/confirmation/api';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';

type TokenScanContext = ConfirmationDataContext & ContextWithTokenScan;

/**
 * Refreshes Blockaid token security scan results in change-trust confirmations.
 */
export class ConfirmationTokenScanRefresher implements IConfirmationContextRefresher {
  readonly key = ConfirmationContextRefresherKey.TokenScan;

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
      '[🔄 ConfirmationTokenScanRefresher]',
    );
  }

  shouldFetch(ctx: ConfirmationDataContext): boolean {
    const scanCtx = ctx as TokenScanContext;
    if (scanCtx.tokenScanFetchStatus === FetchStatus.Error) {
      return false;
    }
    if (!scanCtx.tokenScanRequest) {
      return false;
    }
    return scanCtx.preferences.useSecurityAlerts;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    const scanCtx = ctx as TokenScanContext;
    if (scanCtx.tokenScanFetchStatus !== FetchStatus.Fetching) {
      return null;
    }

    return {
      result: {
        tokenScan: null,
        tokenScanFetchStatus: scanCtx.preferences.useSecurityAlerts
          ? FetchStatus.Error
          : FetchStatus.Fetched,
      },
      reschedule: false,
    };
  }

  async refresh(
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    const scanCtx = ctx as TokenScanContext;
    const { tokenScanRequest } = scanCtx;

    if (!tokenScanRequest) {
      return this.recoveryResult(ctx);
    }

    try {
      const tokenScan = await this.#transactionScanService.scanToken({
        assetReference: tokenScanRequest.assetReference,
        origin: tokenScanRequest.origin,
      });

      return {
        result: {
          tokenScan,
          tokenScanFetchStatus: tokenScan
            ? FetchStatus.Fetched
            : FetchStatus.Error,
        },
        reschedule: tokenScan !== null,
      };
    } catch (error) {
      this.#logger.error(
        'Error refreshing confirmation token security scan:',
        error,
      );
      return {
        result: {
          tokenScan: null,
          tokenScanFetchStatus: FetchStatus.Error,
        },
        reschedule: false,
      };
    }
  }

  isValidContext(ctx: Record<string, Json>): boolean {
    return ContextWithTokenScanStruct.is(ctx);
  }
}
