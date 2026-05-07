import { TransactionStatus } from '@metamask/keyring-api';

import type {
  TrackTransactionJsonRpcRequest,
  TrackTransactionParams,
} from './api';
import {
  BackgroundEventMethod,
  TrackTransactionJsonRpcRequestStruct,
} from './api';
import { CronjobBaseHandler } from './base';
import type { KnownCaip2ChainId } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { NetworkService } from '../../services/network';
import { TransactionPollException } from '../../services/network/exceptions';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import { Duration, scheduleBackgroundEvent } from '../../utils/snap';

/**
 * Polls Soroban RPC for transaction settlement; once complete, runs
 * {@link OnChainAccountService.synchronize} so keyring asset/balance events emit.
 */
export class TrackTransactionHandler extends CronjobBaseHandler<TrackTransactionJsonRpcRequest> {
  static async scheduleBackgroundEvent(
    params: TrackTransactionParams,
    duration: Duration = Duration.OneSecond,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.TrackTransaction,
      params,
      duration,
    });
  }

  readonly #networkService: NetworkService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #accountService: AccountService;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    networkService,
    onChainAccountService,
    accountService,
    transactionService,
  }: {
    logger: ILogger;
    networkService: NetworkService;
    onChainAccountService: OnChainAccountService;
    accountService: AccountService;
    transactionService: TransactionService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[TrackTransactionHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: TrackTransactionJsonRpcRequestStruct,
    });
    this.#networkService = networkService;
    this.#onChainAccountService = onChainAccountService;
    this.#accountService = accountService;
    this.#transactionService = transactionService;
  }

  /**
   * @param request - Cron job JSON-RPC request carrying `txId`, `scope`, and `accountIds`.
   */
  protected async handleCronJobRequest(
    request: TrackTransactionJsonRpcRequest,
  ): Promise<void> {
    const { txId, scope, accountIds, attempt: attemptRaw } = request.params;

    this.logger.debug('Tracking transaction', {
      txId,
      scope,
      attempt: attemptRaw ?? 0,
    });

    const accounts = await this.#accountService.findByIds(accountIds);
    if (accounts.length === 0) {
      this.logger.warn('TrackTransaction: no matching accounts; stopping', {
        accountIds,
      });
      return;
    }

    let keyringStatus:
      | TransactionStatus.Confirmed
      | TransactionStatus.Failed
      | null = null;
    try {
      await this.#networkService.pollTransaction(txId, scope);
      this.logger.info('TrackTransaction: RPC settled; synchronizing', {
        txId,
        scope,
      });
      keyringStatus = TransactionStatus.Confirmed;
    } catch (error: unknown) {
      if (error instanceof TransactionPollException) {
        if (error.status === 'unknown') {
          this.logger.warn(
            'TrackTransaction: poll status unknown; leaving keyring transaction pending',
            { txId, scope },
          );
        } else {
          this.logger.warn('TrackTransaction: poll settled as failed', {
            txId,
            scope,
            status: error.status,
          });
          keyringStatus = TransactionStatus.Failed;
        }
      } else {
        this.logger.logErrorWithDetails(
          'TrackTransaction: unexpected poll error; leaving keyring transaction pending',
          error,
        );
      }
    }

    if (keyringStatus) {
      try {
        await this.#settleKeyringRow(txId, accountIds, keyringStatus);
      } catch (error: unknown) {
        this.logger.logErrorWithDetails(
          'TrackTransaction: failed to update keyring transaction status',
          error,
        );
      }
    }

    await this.#synchronizeAccounts(accounts, scope);
  }

  async #synchronizeAccounts(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    await this.#onChainAccountService.synchronize(accounts, scope);
  }

  async #settleKeyringRow(
    txId: string,
    accountIds: readonly string[],
    keyringStatus: TransactionStatus.Confirmed | TransactionStatus.Failed,
  ): Promise<void> {
    await this.#transactionService.updateKeyringTransactionStatus({
      txId,
      accountIds,
      status: keyringStatus,
    });
  }
}
