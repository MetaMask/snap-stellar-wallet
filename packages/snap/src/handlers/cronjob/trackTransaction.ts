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
import { type KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { METAMASK_ORIGIN } from '../../constants';
import type { AccountService } from '../../services/account';
import {
  NetworkServiceException,
  TransactionNotFoundException,
  type NetworkService,
} from '../../services/network';
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
 * Tracks transaction settlement via Horizon. Each cron run fetches the transaction once
 * via {@link NetworkService.getTransaction}, reschedules via `scheduleBackgroundEvent`
 * when Horizon has not indexed it yet or the request fails, then synchronizes keyring
 * accounts when the status is terminal ({@link TransactionStatus.Confirmed} or
 * {@link TransactionStatus.Failed}).
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
   * @param request - Cron job JSON-RPC request carrying `txId`, `scope`, and `accountIdsOrAddresses`.
   */
  protected async handleCronJobRequest(
    request: TrackTransactionJsonRpcRequest,
  ): Promise<void> {
    // Superstruct has already validated accountIdsOrAddresses: the first entry is the sender UUID.
    const { scope, txId, accountIdsOrAddresses, attempt = 0 } = request.params;

    this.logger.debug('Tracking transaction', {
      txId,
      scope,
      attempt,
    });

    try {
      // getTransaction throws TransactionNotFoundException when Horizon has not indexed the tx yet.
      const transaction = await this.#networkService.getTransaction(
        txId,
        scope,
      );

      // Only synchronize once Horizon reports a terminal status.
      if (
        transaction.status === TransactionStatus.Confirmed ||
        transaction.status === TransactionStatus.Failed
      ) {
        await this.#synchronize(
          scope,
          transaction.status,
          txId,
          accountIdsOrAddresses,
        );
      } else {
        this.logger.warn(
          'Transaction is neither confirmed nor failed; skipping synchronization',
          {
            txId,
            scope,
            status: transaction.status,
          },
        );
      }
    } catch (error: unknown) {
      // Reschedule only when the transaction is not found or the network request fails.
      if (
        error instanceof TransactionNotFoundException ||
        error instanceof NetworkServiceException
      ) {
        await this.#rescheduleWhenHorizonNotIndexed({
          txId,
          scope,
          accountIdsOrAddresses,
          attempt,
        });
        return;
      }
      // For other errors, stop here; the synchronize cron job can recover later.
      this.logger.logErrorWithDetails(
        'Unexpected error when tracking transaction',
        {
          error,
          txId,
          scope,
          attempt,
        },
      );
    }
  }

  /**
   * Reschedules the track job when Horizon has not indexed the tx yet and budget remains.
   *
   * @param params - Inputs for the follow-up background event.
   * @param params.txId - Transaction hash to keep tracking.
   * @param params.scope - CAIP-2 chain id for the network.
   * @param params.accountIdsOrAddresses - Sender account id and optional receiver address passed through to settlement.
   * @param params.attempt - Current track cron attempt (matches serialized `attempt` param).
   */
  async #rescheduleWhenHorizonNotIndexed(
    params: TrackTransactionParams,
  ): Promise<void> {
    const { txId, scope, attempt = 0, accountIdsOrAddresses } = params;
    const maxReschedules = AppConfig.transaction.trackTransactionMaxReschedules;

    if (attempt < maxReschedules) {
      this.logger.debug('Retrying transaction tracking job', {
        txId,
        scope,
        attempt,
        maxReschedules,
      });

      await TrackTransactionHandler.scheduleBackgroundEvent(
        {
          txId,
          scope,
          accountIdsOrAddresses,
          attempt: attempt + 1,
        },
        Duration.TwoSeconds,
      );
      return;
    }

    this.logger.warn('Max tracking attempts reached', {
      txId,
      scope,
      attempt,
      maxReschedules,
    });
  }

  async #synchronize(
    scope: KnownCaip2ChainId,
    status: TransactionStatus.Confirmed | TransactionStatus.Failed,
    txId: string,
    accountIdsOrAddresses: TrackTransactionParams['accountIdsOrAddresses'],
  ): Promise<void> {
    // TODO: Consider removing this transaction status update later; the synchronize cron job may handle it.
    await this.#updateKeyringTransactionStatus(txId, status);

    // The first entry is the sender account UUID (validated by Superstruct).
    const senderAccountId = accountIdsOrAddresses[0];
    const senderAccount = await this.#accountService.findById(senderAccountId);
    if (!senderAccount) {
      this.logger.warn('Sender account not found, skipping synchronization', {
        txId,
        scope,
        senderAccountId,
      });
      return;
    }

    await trackTransactionFinalized({
      origin: METAMASK_ORIGIN,
      accountType: senderAccount.type,
      chainIdCaip: scope,
    });

    const accountsToSynchronize = [senderAccount];

    // The optional second entry is the receiver Stellar address.
    const receiverAccountAddress = accountIdsOrAddresses[1];
    if (
      receiverAccountAddress &&
      receiverAccountAddress !== senderAccount.address
    ) {
      const receiverAccount = await this.#accountService.findByAddressAndScope(
        receiverAccountAddress,
        scope,
      );
      // The receiver may not be in the keyring; absence is not an error.
      if (receiverAccount) {
        accountsToSynchronize.push(receiverAccount);
      }
    }

    await this.#onChainAccountService.synchronize(accountsToSynchronize, scope);
  }

  async #updateKeyringTransactionStatus(
    txId: string,
    status: TransactionStatus.Confirmed | TransactionStatus.Failed,
  ): Promise<void> {
    const keyringTransaction =
      await this.#transactionService.findKeyringTransactionByTransactionId(
        txId,
      );

    if (
      keyringTransaction === null ||
      keyringTransaction.status === TransactionStatus.Confirmed ||
      keyringTransaction.status === TransactionStatus.Failed
    ) {
      this.logger.warn(
        'Keyring transaction not found or already confirmed or failed; skipping transaction status update',
        {
          txId,
          status,
        },
      );
      return;
    }

    await this.#transactionService.save({
      ...keyringTransaction,
      status,
      events: [
        ...keyringTransaction.events,
        { status, timestamp: Math.floor(Date.now() / 1000) },
      ],
    });
  }
}
