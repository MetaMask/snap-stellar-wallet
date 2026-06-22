import type { Json } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { AssetMetadataService } from '../../../services/asset-metadata';
import {
  Transaction,
  type TransactionService,
} from '../../../services/transaction';
import { assertTransactionTimeBound } from '../../../services/transaction/utils';
import type {
  ContextWithSecurityScan,
  ContextWithTransactionValidation,
} from '../../../ui/confirmation/api';
import {
  ContextWithTransactionValidationStruct,
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

type TransactionValidationContext = ConfirmationDataContext &
  ContextWithTransactionValidation;

/**
 * Re-validates the pending transaction while the sign confirmation dialog is open.
 * Transaction slice of the confirmation context refresh pipeline; on every cycle
 * it checks time bounds, fees, and balance against the latest on-chain account
 * state and propagates the rebuilt envelope to the security-scan request.
 */
export class ConfirmationTransactionRefresher implements IConfirmationContextRefresher {
  readonly key = ConfirmationContextRefresherKey.Transaction;

  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #accountResolver: AccountResolver;

  readonly #logger: ILogger;

  constructor({
    logger,
    transactionService,
    assetMetadataService,
    accountResolver,
  }: {
    logger: ILogger;
    transactionService: TransactionService;
    assetMetadataService: AssetMetadataService;
    accountResolver: AccountResolver;
  }) {
    this.#transactionService = transactionService;
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
    const validationCtx = ctx as TransactionValidationContext;
    // A prior cycle already marked the transaction invalid; nothing to re-fetch.
    return validationCtx.transactionsFetchStatus !== FetchStatus.Error;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    const validationCtx = ctx as TransactionValidationContext;
    if (validationCtx.transactionsFetchStatus !== FetchStatus.Fetching) {
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
    const validationCtx = ctx as TransactionValidationContext;
    try {
      const {
        request,
        accountId,
        scope,
        transaction: transactionXdr,
      } = validationCtx;

      // Deserialize the envelope awaiting signature and assert its own time bound.
      // The draft rebuilt below gets a fresh timeout, so validating that draft would
      // miss expiry of the transaction the user is actually looking at.
      const transaction = Transaction.fromXdr({
        xdr: transactionXdr,
        scope,
      });
      assertTransactionTimeBound(transaction);

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

      // TODO(follow-up): this validates a rebuilt draft as a proxy for the stored
      // envelope. It can miss divergence (payment vs createAccount on a deactivated
      // destination, stale Soroban footprint). Seq drift is covered by the submit-time
      // txBadSeq retry. For full fidelity, validate the stored envelope itself.
      let rebuiltTransaction: Transaction;
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
          rebuiltTransaction =
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
          rebuiltTransaction =
            await this.#transactionService.createValidatedChangeTrustTransaction(
              {
                onChainAccount,
                scope,
                assetId: request.params.assetId,
                limit:
                  request.params.action === ChangeTrustOptAction.Delete
                    ? '0'
                    : request.params.limit,
              },
            );
          break;
        default:
          throw new Error('Unsupported request method for transaction refresh');
      }

      // Feed the rebuilt envelope to the security scan so it validates the same
      // envelope re-validation just produced. For these flows the scan is
      // validation-only (simulation is sign-transaction only) and so is
      // timebound-agnostic; expiry of the user-facing transaction is already
      // guarded by `assertTransactionTimeBound` above. The user-facing
      // `transaction` is intentionally left untouched: it is what the dialog
      // shows; the signable envelope is rebuilt again at confirm time.
      return this.#renewScanTransaction(validationCtx, rebuiltTransaction);
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
    return ContextWithTransactionValidationStruct.is(ctx);
  }

  /**
   * Writes the rebuilt transaction into the security-scan request so the scan
   * refresher (which runs after this one) scans the renewed envelope.
   *
   * Returns `null` when the flow has no security scan attached, leaving the
   * transaction status untouched (it stays `Fetched`).
   *
   * @param ctx - The current confirmation context.
   * @param rebuiltTransaction - The freshly rebuilt transaction.
   * @returns A patch updating the scan request, or `null` when there is nothing to propagate.
   */
  #renewScanTransaction(
    ctx: TransactionValidationContext,
    rebuiltTransaction: Transaction,
  ): ConfirmationContextRefreshResult {
    const { securityScanRequest } = ctx as TransactionValidationContext &
      Partial<ContextWithSecurityScan>;
    if (!securityScanRequest) {
      return null;
    }

    return {
      result: {
        securityScanRequest: {
          ...securityScanRequest,
          transaction: rebuiltTransaction.getRaw().toXDR(),
        },
      },
      reschedule: false,
    };
  }
}
