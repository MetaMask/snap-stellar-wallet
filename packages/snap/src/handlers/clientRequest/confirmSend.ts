import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { ensureError } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import type {
  ConfirmSendJsonRpcRequest,
  ConfirmSendJsonRpcResponse,
} from './api';
import {
  ConfirmSendJsonRpcRequestStruct,
  ConfirmSendJsonRpcResponseStruct,
  MultiChainSendErrorCodes,
} from './api';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import type { StellarKeyringAccount } from '../../services/account';
import type {
  AssetMetadataService,
  StellarAssetMetadata,
} from '../../services/asset-metadata';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
  KeyringTransactionType,
} from '../../services/transaction';
import type { TransactionService } from '../../services/transaction';
import type { ContextWithPrices } from '../../ui/confirmation/api';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import { hasDecimals, toSmallestUnit } from '../../utils';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { BaseClientRequestHandler } from './base';
import { AccountNotActivatedException } from '../../services/network';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

/**
 * Confirms and submits a send transaction for Unified Non-EVM Send.
 *
 * Unlike {@link OnAmountInputHandler}, this handler resolves the on-chain account from
 * live network data (default {@link AccountResolver} options) so balance, sequence, and
 * fees are current at submission time.
 */
export class ConfirmSendHandler extends BaseClientRequestHandler<
  ConfirmSendJsonRpcRequest,
  ConfirmSendJsonRpcResponse
> {
  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #confirmationUIController: ConfirmationUXController;

  readonly #logger: ILogger;

  constructor({
    logger,
    accountResolver,
    transactionService,
    assetMetadataService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    transactionService: TransactionService;
    assetMetadataService: AssetMetadataService;
    confirmationUIController: ConfirmationUXController;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[👍 ConfirmSendHandler]',
    );
    super({
      accountResolver,
      logger: prefixedLogger,
      requestStruct: ConfirmSendJsonRpcRequestStruct,
      responseStruct: ConfirmSendJsonRpcResponseStruct,
    });
    this.#transactionService = transactionService;
    this.#assetMetadataService = assetMetadataService;
    this.#confirmationUIController = confirmationUIController;
    this.#logger = prefixedLogger;
  }

  /**
   * Builds a validated send transaction, shows confirmation, then signs and submits.
   *
   * @param resolved - Keyring account, live on-chain snapshot, and wallet.
   * @param request - JSON-RPC request with send params (`scope` is derived from `assetId`).
   * @returns `{ valid: true, errors: [], transactionId }` on success, or `{ valid: false, errors }` for validation failures.
   * @throws {UserRejectedRequestError} If the user rejects the confirmation prompt.
   */
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: ConfirmSendJsonRpcRequest,
  ): Promise<ConfirmSendJsonRpcResponse> {
    try {
      const {
        wallet,
        onChainAccount,
        account: stellarKeyringAccount,
      } = resolved;
      const { amount, toAddress, assetId, scope } = request.params;
      const assetMetadata = await this.#assetMetadataService.resolve(assetId);
      const { decimals, symbol } = assetMetadata.units[0];

      const amountInSmallestUnit = toSmallestUnit(
        new BigNumber(amount),
        decimals,
      );

      if (hasDecimals(amountInSmallestUnit)) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.Invalid }],
        };
      }

      const transaction =
        await this.#transactionService.createValidatedSendTransaction({
          onChainAccount,
          scope,
          assetId,
          amount: amountInSmallestUnit,
          destination: toAddress,
        });

      if (
        !(await this.#confirmSend({
          request,
          account: stellarKeyringAccount,
          assetMetadata,
          scope,
          fee: transaction.totalFee,
        }))
      ) {
        throw ensureError(new UserRejectedRequestError());
      }

      wallet.signTransaction(transaction);

      const transactionId = await this.#transactionService.sendTransaction({
        wallet,
        onChainAccount,
        scope,
        transaction,
        pollTransaction: false,
      });

      await this.#savePendingTransaction({
        txId: transactionId,
        account: stellarKeyringAccount,
        scope,
        toAddress,
        amount,
        asset: {
          type: assetId,
          symbol,
        },
      });

      await TrackTransactionHandler.scheduleBackgroundEvent({
        txId: transactionId,
        scope,
        // TODO: we should depend on the transaction instead of passing an account id here
        accountIds: [stellarKeyringAccount.id],
      });

      return {
        valid: true,
        errors: [],
        transactionId,
      };
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to confirm send transaction',
        error,
      );
      if (error instanceof InsufficientBalanceException) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.InsufficientBalance }],
        };
      }
      if (error instanceof InsufficientBalanceToCoverFeeException) {
        return {
          valid: false,
          errors: [
            { code: MultiChainSendErrorCodes.InsufficientBalanceToCoverFee },
          ],
        };
      }
      if (
        error instanceof TransactionValidationException ||
        error instanceof AccountNotActivatedException
      ) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.Invalid }],
        };
      }
      throw error;
    }
  }

  async #confirmSend(params: {
    request: ConfirmSendJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    scope: KnownCaip2ChainId;
    fee: BigNumber;
  }): Promise<boolean> {
    const { request, account, assetMetadata, fee, scope } = params;
    const { toAddress, amount, assetId } = request.params;

    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope,
        renderContext: {
          account,
          assetMetadata,
          toAddress,
          amount,
        },
        fee: fee.toString(),
        interfaceKey: ConfirmationInterfaceKey.ConfirmSendTransaction,
        renderOptions: {
          loadPrice: true,
        },
        tokenPrices: {
          [assetId]: null,
        } as ContextWithPrices['tokenPrices'],
      })) === true
    );
  }

  async #savePendingTransaction({
    txId,
    account,
    scope,
    toAddress,
    amount,
    asset,
  }: {
    txId: string;
    account: StellarKeyringAccount;
    scope: KnownCaip2ChainId;
    toAddress: string;
    amount: string;
    asset: {
      type: KnownCaip19AssetIdOrSlip44Id;
      symbol: string;
    };
  }): Promise<void> {
    try {
      await this.#transactionService.savePendingKeyringTransaction({
        type: KeyringTransactionType.Send,
        request: {
          txId,
          account,
          scope,
          toAddress,
          amount,
          asset,
        },
      });
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to save pending transaction',
        error,
      );
      // we should not throw error here, as we want to continue the flow even if the pending transaction is not saved
    }
  }

  /**
   * Override the base handler to return invalid when the account is not activated.
   * Instead of showing the account not activated alert, it returns an invalid response.
   *
   * @param _error - The error to handle.
   * @returns The invalid response when the account is not activated.
   */
  protected override async handleAccountNotActivatedError(
    _error: AccountNotActivatedException,
  ): Promise<ConfirmSendJsonRpcResponse> {
    return {
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    };
  }
}
