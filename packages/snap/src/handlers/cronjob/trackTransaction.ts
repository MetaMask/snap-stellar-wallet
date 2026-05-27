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
import type { TrackTransactionTrustlineVerification } from './trackTransactionHorizonTrustline';
import {
  delayMilliseconds,
  isHorizonTrustlineMatchingExpectation,
  TrackTransactionTrustlineAction,
} from './trackTransactionHorizonTrustline';
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

/** Horizon trustline polls after RPC success (Soroban can lead Horizon indexing). */
const HORIZON_TRUSTLINE_VERIFY_MAX_ATTEMPTS = 6;

/** Delay between Horizon verification sync attempts. */
const HORIZON_TRUSTLINE_VERIFY_DELAY_MS = 2000;

/**
 * Polls Soroban RPC for transaction settlement first, then updates keyring status and runs
 * {@link OnChainAccountService.synchronize}. The persisted keyring transaction in snap state
 * (by hash) is the source of truth for which account to sync.
 *
 * Change-trust jobs may pass `trustlineVerification`; those sync until a fresh Horizon load
 * matches the expected trustline before marking the keyring row Confirmed.
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

    // When no row exists in snap state, we still poll (inclusion can still be observed) and
    // `updateKeyringTransactionStatus` still runs via cron `accountIds` when the poll is
    // terminal. Whether to short-circuit or reschedule in that case is unresolved.
    // TODO: Revisit behavior when `findKeyringTransactionByTransactionId`
    // returns undefined (e.g. early-exit poll, stronger logging, or reschedule policy).
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

    const accountsToSync = await this.#resolveAccountsForSynchronize({
      persistedKeyringTransaction,
    });
    const { trustlineVerification } = request.params;

    if (accountsToSync.length > 0) {
      if (
        keyringStatus === TransactionStatus.Confirmed &&
        trustlineVerification
      ) {
        await this.#synchronizeUntilHorizonTrustlineMatches({
          accounts: accountsToSync,
          scope,
          verification: {
            assetId: trustlineVerification.assetId,
            action:
              trustlineVerification.action === 'add'
                ? TrackTransactionTrustlineAction.Add
                : TrackTransactionTrustlineAction.Delete,
          },
        });
      } else if (keyringStatus === TransactionStatus.Confirmed) {
        await this.#synchronizeAccounts(accountsToSync, scope);
      }
    }

    if (keyringStatus) {
      await this.#settleKeyringRow(txId, accountIds, keyringStatus);
    }

    if (
      accountsToSync.length > 0 &&
      keyringStatus !== TransactionStatus.Confirmed
    ) {
      await this.#synchronizeAccounts(accountsToSync, scope);
    }

    if (accountsToSync.length === 0) {
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

  async #synchronizeAccounts(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    await this.#onChainAccountService.synchronize(accounts, scope);
  }

  /**
   * Syncs and re-reads Horizon until trustline state matches `verification`, then stops.
   *
   * @param params - Sync and verification inputs.
   * @param params.accounts - Keyring accounts to synchronize.
   * @param params.scope - CAIP-2 network for Horizon loads.
   * @param params.verification - Expected classic trustline outcome after the tx.
   */
  async #synchronizeUntilHorizonTrustlineMatches(params: {
    accounts: StellarKeyringAccount[];
    scope: KnownCaip2ChainId;
    verification: TrackTransactionTrustlineVerification;
  }): Promise<void> {
    const { accounts, scope, verification } = params;
    const account = accounts[0];
    if (!account) {
      return;
    }

    for (
      let attempt = 0;
      attempt < HORIZON_TRUSTLINE_VERIFY_MAX_ATTEMPTS;
      attempt += 1
    ) {
      await this.#synchronizeAccounts(accounts, scope);

      const horizonAccount =
        await this.#onChainAccountService.resolveOnChainAccount(
          account.address,
          scope,
        );

      if (
        isHorizonTrustlineMatchingExpectation(
          horizonAccount,
          verification.assetId,
          verification.action,
        )
      ) {
        this.logger.info(
          'TrackTransaction: Horizon trustline matches expectation',
          {
            attempt,
            assetId: verification.assetId,
            action: verification.action,
          },
        );
        return;
      }

      if (attempt < HORIZON_TRUSTLINE_VERIFY_MAX_ATTEMPTS - 1) {
        this.logger.warn(
          'TrackTransaction: Horizon trustline not yet consistent; retrying',
          {
            attempt,
            assetId: verification.assetId,
            action: verification.action,
          },
        );
        await delayMilliseconds(HORIZON_TRUSTLINE_VERIFY_DELAY_MS);
      }
    }

    this.logger.warn(
      'TrackTransaction: Horizon trustline verification exhausted attempts',
      {
        assetId: verification.assetId,
        action: verification.action,
        maxAttempts: HORIZON_TRUSTLINE_VERIFY_MAX_ATTEMPTS,
      },
    );
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
