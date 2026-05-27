import type { Json } from '@metamask/utils';

import {
  ConfirmationContextRefresherKey,
  type ConfirmationContextRefreshResult,
  type ConfirmationDataContext,
  type IConfirmationContextRefresher,
} from './api';
import type { AssetMetadataService } from '../../../services/asset-metadata';
import type { TransactionService } from '../../../services/transaction';
import { assertTransactionTimeBound } from '../../../services/transaction/utils';
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
    if (ctx.transactionsFetchStatus === FetchStatus.Error) {
      return false;
    }
    return true;
  }

  recoveryResult(
    ctx: ConfirmationDataContext,
  ): ConfirmationContextRefreshResult {
    if (ctx.transactionsFetchStatus !== FetchStatus.Fetching) {
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
    try {
      const { request, accountId, scope, transaction: transactionXdr } = ctx;

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

      // Deserialize the transaction envelope that is awaiting signature in the sign dialog.
      const transaction = this.#transactionService.builder.deserialize({
        xdr: transactionXdr,
        scope,
      });

      // Check this envelope's time bound but not the draft transcation that will be created below.
      // Becauses the new draft transaction get a fresh timeout,
      // so validating them would miss expiry of the transaction the user is actually looking at.
      assertTransactionTimeBound(transaction);

      // Rebuild a draft from the original request and run full validation against latest chain state.
      switch (request.method) {
        case ClientRequestMethod.ConfirmSend:
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
          throw new Error(`Unknown request method`);
      }
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
