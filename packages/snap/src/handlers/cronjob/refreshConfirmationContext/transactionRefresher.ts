import type { Json } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { KnownCaip2ChainId } from '../../../api';
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
 * Keep scanning the current envelope until it is within this window of expiry,
 * then swap in a freshly rebuilt one. Comfortably larger than the ~20s refresh
 * cadence so the scanned transaction is always renewed before it can expire
 * between cycles, while avoiding a needless swap on every cycle. Mirrors TRON's
 * `hasFreshExpiration` buffer.
 */
const SCAN_TRANSACTION_REFRESH_BUFFER_SECONDS = 60;

/**
 * Re-validates the pending transaction while the sign confirmation dialog is open.
 * Transaction slice of the confirmation context refresh pipeline; periodically
 * checks time bounds, fees, and balance against the latest on-chain account state.
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
      const transaction = Transaction.fromXdr({
        xdr: transactionXdr,
        scope,
      });
      assertTransactionTimeBound(transaction);

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

      // Feed the rebuilt envelope (with a fresh time bound) to the security scan
      // so simulation/validation never runs against an expired transaction. The
      // user-facing `transaction` is intentionally left untouched: it is what the
      // dialog shows and what `assertTransactionTimeBound` guards above; the
      // signable envelope is rebuilt again at confirm time.
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
   * Skips the swap while the currently-scanned envelope is still comfortably
   * far from expiry, keeping the Blockaid scan stable on a single envelope
   * instead of churning onto a freshly rebuilt one every cycle.
   *
   * Returns `null` when the flow has no security scan attached (or the scanned
   * envelope is still fresh), leaving the transaction status untouched (it stays
   * `Fetched`).
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

    if (
      this.#isScanTransactionFresh(securityScanRequest.transaction, ctx.scope)
    ) {
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

  /**
   * Whether the currently-scanned envelope still has comfortable time before
   * expiry and can keep being scanned as-is.
   *
   * @param xdr - The envelope currently held in the security-scan request.
   * @param scope - The network scope used to deserialize the envelope.
   * @returns True when the envelope is fresh enough to keep scanning.
   */
  #isScanTransactionFresh(xdr: string, scope: KnownCaip2ChainId): boolean {
    try {
      const { expirationTime } = Transaction.fromXdr({ xdr, scope });
      // No upper bound: the envelope never expires, so keep scanning it.
      if (expirationTime === undefined) {
        return true;
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      return (
        expirationTime > nowSeconds + SCAN_TRANSACTION_REFRESH_BUFFER_SECONDS
      );
    } catch {
      // Unparseable scan envelope: refresh it.
      return false;
    }
  }
}
