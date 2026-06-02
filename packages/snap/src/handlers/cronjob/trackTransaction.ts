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
import { AppConfig } from '../../config';
import { KEYRING_ACCOUNT_TYPE, METAMASK_ORIGIN } from '../../constants';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { NetworkService } from '../../services/network';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  Duration,
  scheduleBackgroundEvent,
  trackTransactionFinalized,
} from '../../utils/snap';

/**
 * Tracks transaction settlement via Horizon inclusion. Each cron run calls
 * {@link NetworkService.checkHorizonTransactionForTrack} once; reschedules via
 * `scheduleBackgroundEvent` when the result is `'pending'`, then syncs before settling
 * Confirmed. The persisted keyring transaction in snap state (by hash) is the source of truth for
 * which account to sync.
 */
export class TrackTransactionHandler extends CronjobBaseHandler<TrackTransactionJsonRpcRequest> {
  static async scheduleBackgroundEvent(
    params: TrackTransactionParams,
    duration: Duration = Duration.TwoSeconds,
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
    const { txId, scope, accountIds, attempt = 0 } = request.params;

    this.logger.debug('Tracking transaction', {
      txId,
      scope,
      attempt,
    });

    // When no row exists in snap state, we still check Horizon (inclusion can still be observed)
    // and `updateKeyringTransactionStatus` still runs via cron `accountIds` when terminal.
    // TODO: Revisit behavior when `findKeyringTransactionByTransactionId`
    // returns undefined (e.g. early-exit, stronger logging, or reschedule policy).
    const persistedKeyringTransaction =
      await this.#transactionService.findKeyringTransactionByTransactionId(
        txId,
      );

    const accountsToSync = await this.#resolveAccountsForSynchronize({
      persistedKeyringTransaction,
    });

    const trackStatus =
      await this.#networkService.checkHorizonTransactionForTrack(txId, scope);

    if (trackStatus === 'pending') {
      const rescheduled = await this.#rescheduleWhenHorizonNotIndexed({
        txId,
        scope,
        accountIds,
        attempt,
      });
      if (rescheduled) {
        return;
      }
    }

    let keyringStatus:
      | TransactionStatus.Confirmed
      | TransactionStatus.Failed
      | null = null;

    if (trackStatus === 'confirmed') {
      this.logger.info('TrackTransaction: Horizon settled; synchronizing', {
        txId,
        scope,
      });
      await this.#synchronizeIfNeeded(accountsToSync, scope, {
        txId,
        persistedAccountId: persistedKeyringTransaction?.account,
      });
      keyringStatus = TransactionStatus.Confirmed;

      // TODO: we hardcode the account type, and orgin for now,
      // We will address it when this module is refactored.
      await trackTransactionFinalized({
        origin: METAMASK_ORIGIN,
        accountType: KEYRING_ACCOUNT_TYPE,
        chainIdCaip: scope,
      });
    } else if (trackStatus === 'failed') {
      this.logger.warn('TrackTransaction: Horizon settled as failed', {
        txId,
        scope,
      });
      await this.#synchronizeIfNeeded(accountsToSync, scope, {
        txId,
        persistedAccountId: persistedKeyringTransaction?.account,
      });
      keyringStatus = TransactionStatus.Failed;
    } else {
      this.logger.warn(
        'TrackTransaction: leaving keyring transaction pending after Horizon track check',
        {
          txId,
          scope,
          attempt,
          outcome: trackStatus === 'pending' ? 'notIndexed' : 'unavailable',
        },
      );
    }

    if (keyringStatus) {
      await this.#settleKeyringRow(txId, accountIds, keyringStatus);
    } else if (accountsToSync.length > 0) {
      await this.#synchronizeAccounts(accountsToSync, scope);
    }
  }

  /**
   * Reschedules the track job when Horizon has not indexed the tx yet and budget remains.
   *
   * @param params - Inputs for the follow-up background event.
   * @param params.txId - Transaction hash to keep tracking.
   * @param params.scope - CAIP-2 chain id for the network.
   * @param params.accountIds - Keyring account ids passed through to settlement.
   * @param params.attempt - Current track cron attempt (matches serialized `attempt` param).
   * @returns True when a follow-up background event was scheduled.
   */
  async #rescheduleWhenHorizonNotIndexed(params: {
    txId: string;
    scope: KnownCaip2ChainId;
    accountIds: readonly string[];
    attempt: number;
  }): Promise<boolean> {
    const { txId, scope, accountIds, attempt } = params;
    const maxReschedules = AppConfig.transaction.trackTransactionMaxReschedules;

    if (attempt < maxReschedules) {
      this.logger.debug(
        'TrackTransaction: Horizon not indexed; scheduling reschedule',
        { txId, scope, attempt, maxReschedules },
      );
      await TrackTransactionHandler.scheduleBackgroundEvent(
        {
          txId,
          scope,
          accountIds: [...accountIds],
          attempt: attempt + 1,
        },
        Duration.TwoSeconds,
      );
      return true;
    }

    this.logger.warn(
      'TrackTransaction: Horizon not indexed after max reschedules; leaving keyring transaction pending',
      {
        txId,
        scope,
        attempt,
        maxReschedules,
      },
    );
    return false;
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

  async #synchronizeIfNeeded(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
    context: { txId: string; persistedAccountId: string | undefined },
  ): Promise<void> {
    if (accounts.length > 0) {
      await this.#synchronizeAccounts(accounts, scope);
      return;
    }

    this.logger.warn(
      'TrackTransaction: account not found when tracking the transaction, unable to sync',
      {
        txId: context.txId,
        scope,
        persistedAccountId: context.persistedAccountId,
      },
    );
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
