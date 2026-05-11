import {
  TransactionStatus,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

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
 * Polls Soroban RPC for transaction settlement first, then updates keyring status and runs
 * {@link OnChainAccountService.synchronize}. The persisted keyring transaction in snap state
 * (by hash) is the source of truth for which account to sync; cron `accountIds` are a fallback.
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

    const persistedKeyringTransaction =
      await this.#transactionService.findKeyringTransactionByTransactionId(
        txId,
      );

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

    const accountsToSync = await this.#resolveAccountsForSynchronize({
      accountIds,
      persistedKeyringTransaction,
    });
    if (accountsToSync.length > 0) {
      await this.#synchronizeAccounts(accountsToSync, scope);
    }
  }

  /**
   * Resolves keyring accounts to sync: prefers the account id on the persisted keyring
   * transaction; otherwise uses `accountIds` from the cron request.
   *
   * @param params - Resolution inputs.
   * @param params.persistedKeyringTransaction - Pending row from snap state, if any.
   * @param params.accountIds - Keyring account ids from the track request (fallback).
   * @returns Accounts to pass to {@link OnChainAccountService.synchronize}.
   */
  async #resolveAccountsForSynchronize(params: {
    persistedKeyringTransaction: KeyringTransaction | undefined;
    accountIds: readonly string[];
  }): Promise<StellarKeyringAccount[]> {
    const { accountIds, persistedKeyringTransaction } = params;

    if (persistedKeyringTransaction) {
      const account = await this.#accountService.findById(
        persistedKeyringTransaction.account,
      );
      if (account) {
        return [account];
      }
      this.logger.warn(
        'TrackTransaction: persisted transaction references missing keyring account; falling back to accountIds',
        {
          txId: persistedKeyringTransaction.id,
          accountId: persistedKeyringTransaction.account,
        },
      );
    }

    return await this.#accountService.findByIds([...accountIds]);
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
