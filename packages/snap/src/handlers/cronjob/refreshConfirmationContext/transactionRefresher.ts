import type { Json } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { AssetMetadataService } from '../../../services/asset-metadata';
import type {
  TransactionBuilder,
  TransactionService,
} from '../../../services/transaction';
import { assertTransactionTimeBound } from '../../../services/transaction/utils';
import type { ContextWithTransactionScan } from '../../../ui/confirmation/api';
import {
  ContextWithTransactionScanStruct,
  FetchStatus,
} from '../../../ui/confirmation/api';
import { toSmallestUnit } from '../../../utils/currency';
import type { ILogger } from '../../../utils/logger';
import { createPrefixedLogger } from '../../../utils/logger';
import type { AccountResolver } from '../../accountResolver';
import { ResolveAccountSource } from '../../accountResolver';
import {
  ChangeTrustOptAction,
  ClientRequestMethod,
} from '../../clientRequest/api';

type TransactionScanContext = ConfirmationDataContext &
  ContextWithTransactionScan;

/**
 * Re-validates the pending transaction while the sign confirmation dialog is open.
 * Transaction slice of the confirmation context refresh pipeline; periodically
 * checks time bounds, fees, and balance against the latest on-chain account state.
 */
export class ConfirmationTransactionRefresher implements IConfirmationContextRefresher {
  readonly key = ConfirmationContextRefresherKey.Transaction;

  readonly #transactionService: TransactionService;

  readonly #transactionBuilder: TransactionBuilder;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #accountResolver: AccountResolver;

  readonly #logger: ILogger;

  constructor({
    logger,
    transactionService,
    transactionBuilder,
    assetMetadataService,
    accountResolver,
  }: {
    logger: ILogger;
    transactionService: TransactionService;
    transactionBuilder: TransactionBuilder;
    assetMetadataService: AssetMetadataService;
    accountResolver: AccountResolver;
  }) {
    this.#transactionService = transactionService;
    this.#transactionBuilder = transactionBuilder;
    this.#assetMetadataService = assetMetadataService;
    this.#accountResolver = accountResolver;
    this.#logger = createPrefixedLogger(
      logger,
      '[🔄 ConfirmationTransactionRefresher]',
    );
  }

  shouldFetch(ctx: ConfirmationDataContext): boolean {
    if (!this.isValidContext(ctx)) {
      return false;
    }
    const scanCtx = ctx as TransactionScanContext;
    // A prior cycle already marked the transaction invalid; nothing to re-fetch.
    return scanCtx.transactionsFetchStatus !== FetchStatus.Error;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    const scanCtx = ctx as TransactionScanContext;
    if (scanCtx.transactionsFetchStatus !== FetchStatus.Fetching) {
      return null;
    }

    return {
      result: { transactionsFetchStatus: FetchStatus.Fetched },
      reschedule: false,
    };
  }

  async refresh(
    ctx: ConfirmationDataContext,
  ): Promise<ConfirmationContextRefreshResult> {
    const scanCtx = ctx as TransactionScanContext;
    try {
      const {
        request,
        accountId,
        scope,
        transaction: transactionXdr,
      } = scanCtx;

      // Load the sender from the network so validation uses current sequence and balances.
      const { onChainAccount } = await this.#accountResolver.resolveAccount({
        accountId,
        scope,
        options: {
          onChainAccount: {
            load: true,
            source: ResolveAccountSource.OnChain,
          },
          wallet: false,
        },
      });

      // Deserialize the envelope awaiting signature and assert its own time bound.
      // The draft rebuilt below gets a fresh timeout, so validating that draft would
      // miss expiry of the transaction the user is actually looking at.
      const transaction = this.#transactionBuilder.deserialize({
        xdr: transactionXdr,
        scope,
      });
      assertTransactionTimeBound(transaction);

      // TODO(follow-up): this validates a rebuilt draft as a proxy for the stored
      // envelope. It can miss divergence (payment vs createAccount on a deactivated
      // destination, stale Soroban footprint). Seq drift is covered by the submit-time
      // txBadSeq retry. For full fidelity, validate the stored envelope itself.
      switch (request.method) {
        case ClientRequestMethod.ConfirmSend: {
          const assetMetadata = await this.#assetMetadataService.resolve(
            request.params.assetId,
          );
          const { decimals } = assetMetadata.units[0];
          const amount = toSmallestUnit(
            new BigNumber(request.params.amount),
            decimals,
          );
          // Throws on insufficient balance, inactive destination, or fee estimate failure.
          await this.#transactionService.createValidatedSendTransaction({
            onChainAccount,
            scope,
            assetId: request.params.assetId,
            destination: request.params.toAddress,
            amount,
          });
          break;
        }
        case ClientRequestMethod.ChangeTrustOpt:
          // Throws when change-trust limits or account state are no longer valid.
          await this.#transactionService.createValidatedChangeTrustTransaction({
            onChainAccount,
            scope,
            assetId: request.params.assetId,
            limit:
              request.params.action === ChangeTrustOptAction.Delete
                ? '0'
                : request.params.limit,
          });
          break;
        default:
          throw new Error('Unsupported request method for transaction refresh');
      }

      // Still valid: nothing to write. The status stays Fetched and we don't drive a
      // reschedule ourselves (other refreshers keep the cron alive while the dialog is open).
      return null;
    } catch (error) {
      this.#logger.error(
        'Error re-validating confirmation transaction:',
        error,
      );
      return {
        result: { transactionsFetchStatus: FetchStatus.Error },
        reschedule: false,
      };
    }
  }

  isValidContext(ctx: Record<string, Json>): boolean {
    return ContextWithTransactionScanStruct.is(ctx);
  }
}
