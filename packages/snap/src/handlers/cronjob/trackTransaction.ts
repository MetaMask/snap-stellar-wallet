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
import type { AccountService } from '../../services/account';
import type { NetworkService } from '../../services/network';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import { scheduleBackgroundEvent } from '../../utils/snap';

/** Poll budget for Horizon inclusion after submit (matches Tron snap pattern). */
const TRACK_TRANSACTION_MAX_ATTEMPTS = 15;

export class TrackTransactionHandler extends CronjobBaseHandler<TrackTransactionJsonRpcRequest> {
  static readonly duration = 'PT1S';

  static async scheduleBackgroundEvent(
    params: TrackTransactionParams,
    duration: string = TrackTransactionHandler.duration,
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
   * Polls Horizon for transaction inclusion; on settlement or max attempts runs
   * {@link OnChainAccountService.synchronize} so keyring asset/balance events emit.
   *
   * @param request - Cron job JSON-RPC request carrying `txId`, `scope`, and `accountIds`.
   */
  async handleCronJobRequest(
    request: TrackTransactionJsonRpcRequest,
  ): Promise<void> {
    const { txId, scope, accountIds, attempt: attemptRaw } = request.params;
    const attempt = attemptRaw ?? 0;

    this.logger.info('Tracking transaction', {
      txId,
      scope,
      attempt: attempt + 1,
      maxAttempts: TRACK_TRANSACTION_MAX_ATTEMPTS,
    });

    const accounts = await this.#accountService.findByIds(accountIds);
    if (accounts.length === 0) {
      this.logger.warn('TrackTransaction: no matching accounts; stopping', {
        accountIds,
      });
      return;
    }

    const synchronizeAccounts = async (): Promise<void> => {
      await this.#onChainAccountService.synchronize(accounts, scope);
    };

    const settleKeyringRow = async (
      keyringStatus: TransactionStatus.Confirmed | TransactionStatus.Failed,
    ): Promise<void> => {
      await this.#transactionService.applyKeyringTransactionSettlement({
        txId,
        accountIds,
        status: keyringStatus,
      });
    };

    if (attempt >= TRACK_TRANSACTION_MAX_ATTEMPTS) {
      this.logger.warn(
        'TrackTransaction: max attempts reached; synchronizing accounts',
        { txId, scope },
      );
      try {
        const lastStatus =
          await this.#networkService.getHorizonTransactionInclusionStatus(
            txId,
            scope,
          );
        if (lastStatus === 'success') {
          await settleKeyringRow(TransactionStatus.Confirmed);
        } else if (lastStatus === 'failed') {
          await settleKeyringRow(TransactionStatus.Failed);
        }
      } catch (error: unknown) {
        this.logger.logErrorWithDetails(
          'TrackTransaction: final Horizon poll failed',
          error,
        );
      }
      await synchronizeAccounts();
      return;
    }

    try {
      const status =
        await this.#networkService.getHorizonTransactionInclusionStatus(
          txId,
          scope,
        );

      if (status === 'pending') {
        await TrackTransactionHandler.scheduleBackgroundEvent(
          {
            txId,
            scope,
            accountIds,
            attempt: attempt + 1,
          },
          TrackTransactionHandler.duration,
        );
        return;
      }

      this.logger.info('TrackTransaction: Horizon settled; synchronizing', {
        txId,
        scope,
        status,
      });
      if (status === 'success') {
        await settleKeyringRow(TransactionStatus.Confirmed);
      } else {
        await settleKeyringRow(TransactionStatus.Failed);
      }
      await synchronizeAccounts();
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'TrackTransaction: Horizon poll error; will retry',
        error,
      );
      if (attempt < TRACK_TRANSACTION_MAX_ATTEMPTS - 1) {
        await TrackTransactionHandler.scheduleBackgroundEvent(
          {
            txId,
            scope,
            accountIds,
            attempt: attempt + 1,
          },
          TrackTransactionHandler.duration,
        );
      } else {
        await synchronizeAccounts();
      }
    }
  }
}
