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
  TransactionNotFoundException,
  type NetworkService,
  NetworkServiceException,
} from '../../services/network';
import type { SynchronizeService } from '../../services/sync/SynchronizeService';
import { isCompletedTransactionStatus } from '../../services/transaction/utils';
import { trackErrorIfNeeded } from '../../utils';
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
 * accounts when the status is terminal (confirmed or failed).
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

  readonly #synchronizeService: SynchronizeService;

  readonly #accountService: AccountService;

  constructor({
    logger,
    networkService,
    synchronizeService,
    accountService,
  }: {
    logger: ILogger;
    networkService: NetworkService;
    synchronizeService: SynchronizeService;
    accountService: AccountService;
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
    this.#synchronizeService = synchronizeService;
    this.#accountService = accountService;
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
      if (isCompletedTransactionStatus(transaction.status)) {
        await this.#synchronize(scope, accountIdsOrAddresses);
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
      this.logger.warn('Unexpected error when tracking transaction', {
        error,
        txId,
        scope,
        attempt,
      });

      await trackErrorIfNeeded(error);
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
    accountIdsOrAddresses: TrackTransactionParams['accountIdsOrAddresses'],
  ): Promise<void> {
    // The first entry is the sender account UUID (validated by Superstruct).
    const senderAccountId = accountIdsOrAddresses[0];
    const senderAccount = await this.#accountService.findById(senderAccountId);
    if (!senderAccount) {
      this.logger.warn('Sender account not found, skipping synchronization', {
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

    // Synchronize accounts right away without using the synchronize cron job.
    await this.#synchronizeService.synchronize(accountsToSynchronize, {
      scope,
    });
  }
}
