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
  TrackTransactionOnChainReconciliation,
} from './api';
import { CronjobBaseHandler } from './base';
import { reconcileAfterRpcSuccess } from './trackTransactionReconciliation';
import type { KnownCaip2ChainId } from '../../api';
import { KEYRING_ACCOUNT_TYPE, METAMASK_ORIGIN } from '../../constants';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { NetworkService } from '../../services/network';
import { TransactionPollException } from '../../services/network/exceptions';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { OnChainAccountRepository } from '../../services/on-chain-account/OnChainAccountRepository';
import type { TransactionService } from '../../services/transaction';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  Duration,
  scheduleBackgroundEvent,
  trackTransactionFinalized,
} from '../../utils/snap';

/**
 * Polls Soroban RPC for transaction settlement first, optionally waits for Horizon-indexed
 * account state, then updates keyring status and runs {@link OnChainAccountService.synchronize}.
 * The persisted keyring transaction in snap state (by hash) is the source of truth for which
 * account to sync.
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

  readonly #onChainAccountRepository: OnChainAccountRepository;

  readonly #accountService: AccountService;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    networkService,
    onChainAccountService,
    onChainAccountRepository,
    accountService,
    transactionService,
  }: {
    logger: ILogger;
    networkService: NetworkService;
    onChainAccountService: OnChainAccountService;
    onChainAccountRepository: OnChainAccountRepository;
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
    this.#onChainAccountRepository = onChainAccountRepository;
    this.#accountService = accountService;
    this.#transactionService = transactionService;
  }

  /**
   * @param request - Cron job JSON-RPC request carrying `txId`, `scope`, and `accountIds`.
   */
  protected async handleCronJobRequest(
    request: TrackTransactionJsonRpcRequest,
  ): Promise<void> {
    const {
      txId,
      scope,
      accountIds,
      attempt: attemptRaw,
      onChainReconciliation,
    } = request.params;

    this.logger.debug('Tracking transaction', {
      txId,
      scope,
      attempt: attemptRaw ?? 0,
      onChainReconciliation:
        onChainReconciliation ?? TrackTransactionOnChainReconciliation.None,
    });

    // When no row exists in snap state, we still poll (inclusion can still be observed) and
    // `updateKeyringTransactionStatus` still runs via cron `accountIds` when the poll is
    // terminal. Whether to short-circuit or reschedule in that case is unresolved.
    // TODO: Revisit behavior when `findKeyringTransactionByTransactionId`
    // returns undefined (e.g. early-exit poll, stronger logging, or reschedule policy).
    const persistedKeyringTransaction =
      await this.#transactionService.findKeyringTransactionByTransactionId(
        txId,
      );

    const accountsToSync = await this.#resolveAccountsForSynchronize({
      persistedKeyringTransaction,
    });

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

      // TODO: we hardcode the account type, and orgin for now,
      // We will address it when this module is refactored.
      await trackTransactionFinalized({
        origin: METAMASK_ORIGIN,
        accountType: KEYRING_ACCOUNT_TYPE,
        chainIdCaip: scope,
      });
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

    const reconciliationMode =
      onChainReconciliation ?? TrackTransactionOnChainReconciliation.None;

    if (
      keyringStatus === TransactionStatus.Confirmed &&
      accountsToSync.length > 0
    ) {
      const account = accountsToSync[0];
      if (account) {
        const baselineSnapshot =
          await this.#onChainAccountRepository.findByKeyringAccountId(
            account.id,
            scope,
          );

        await reconcileAfterRpcSuccess({
          mode: reconciliationMode,
          context: {
            accountId: account.id,
            scope,
            baselineSequence: baselineSnapshot?.sequenceNumber ?? '0',
          },
          synchronize: async () => {
            await this.#synchronizeAccounts(accountsToSync, scope);
          },
          readPersistedSequence: async () => {
            return this.#readPersistedSequence(account.id, scope);
          },
          logger: this.logger,
        });
      }
    }

    if (keyringStatus) {
      await this.#settleKeyringRow(txId, accountIds, keyringStatus);
    }

    // TODO: Consider skipping synchronize when the keyring row stayed
    // pending (no terminal poll result) to avoid redundant on-chain refreshes.
    if (
      accountsToSync.length > 0 &&
      keyringStatus !== TransactionStatus.Confirmed
    ) {
      await this.#synchronizeAccounts(accountsToSync, scope);
    } else if (accountsToSync.length === 0) {
      this.logger.warn(
        'TrackTransaction: account not found when tracking the transaction, unable to sync',
        {
          txId,
          scope,
          persistedAccountId: persistedKeyringTransaction?.account,
        },
      );
    }
  }

  /**
   * Resolves keyring accounts to sync from the persisted keyring transaction only.
   *
   * @param params - Resolution inputs.
   * @param params.persistedKeyringTransaction - Pending row from snap state, if any.
   * @returns Accounts to pass to {@link OnChainAccountService.synchronize}.
   */
  async #resolveAccountsForSynchronize(params: {
    persistedKeyringTransaction: KeyringTransaction | undefined;
  }): Promise<StellarKeyringAccount[]> {
    const { persistedKeyringTransaction } = params;

    if (!persistedKeyringTransaction) {
      return [];
    }

    const account = await this.#accountService.findById(
      persistedKeyringTransaction.account,
    );
    if (account) {
      return [account];
    }

    return [];
  }

  async #readPersistedSequence(
    accountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<string | null> {
    const snapshot =
      await this.#onChainAccountRepository.findByKeyringAccountId(
        accountId,
        scope,
      );
    return snapshot?.sequenceNumber ?? null;
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
    try {
      await this.#transactionService.updateKeyringTransactionStatus({
        txId,
        accountIds,
        status: keyringStatus,
      });
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'TrackTransaction: failed to update keyring transaction status',
        error,
      );
    }
  }
}
