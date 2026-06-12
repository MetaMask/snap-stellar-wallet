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
import { assertRefreshedTransactionFeeNotHigher } from './utils';
import type { KnownCaip2ChainId } from '../../api';
import { METAMASK_ORIGIN } from '../../constants';
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
import type {
  Transaction,
  TransactionService,
} from '../../services/transaction';
import type { ContextWithPrices } from '../../ui/confirmation/api';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import {
  hasDecimals,
  toSmallestUnit,
  trackTransactionAdded,
  trackTransactionApproved,
  trackTransactionRejected,
} from '../../utils';
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
      const { onChainAccount, account: stellarKeyringAccount } = resolved;
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

      await trackTransactionAdded({
        origin: METAMASK_ORIGIN,
        accountType: stellarKeyringAccount.type,
        chainIdCaip: scope,
      });

      if (
        !(await this.#confirmSend({
          request,
          account: stellarKeyringAccount,
          assetMetadata,
          scope,
          fee: transaction.totalFee,
          transaction,
        }))
      ) {
        await trackTransactionRejected({
          origin: METAMASK_ORIGIN,
          accountType: stellarKeyringAccount.type,
          chainIdCaip: scope,
        });
        throw ensureError(new UserRejectedRequestError());
      }

      await trackTransactionApproved({
        origin: METAMASK_ORIGIN,
        accountType: stellarKeyringAccount.type,
        chainIdCaip: scope,
      });

      const {
        wallet: refreshedWallet,
        onChainAccount: refreshedOnChainAccount,
        transaction: refreshedTransaction,
      } = await this.#refreshTransactionAfterConfirmation({
        request,
        confirmedTransaction: transaction,
        amount: amountInSmallestUnit,
      });

      refreshedWallet.signTransaction(refreshedTransaction);

      const transactionId = await this.#transactionService.sendTransaction({
        wallet: refreshedWallet,
        onChainAccount: refreshedOnChainAccount,
        scope,
        transaction: refreshedTransaction,
        pollTransaction: false,
      });

      await this.#transactionService.savePendingKeyringTransactionSafe({
        type: KeyringTransactionType.Send,
        request: {
          txId: transactionId,
          account: stellarKeyringAccount,
          scope,
          toAddress,
          asset: {
            type: assetId,
            unit: symbol,
            amount,
            fungible: true as const,
          },
        },
      });

      await TrackTransactionHandler.scheduleBackgroundEvent({
        txId: transactionId,
        accountIdsOrAddresses: [stellarKeyringAccount.id, toAddress],
        scope,
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

  async #refreshTransactionAfterConfirmation(params: {
    request: ConfirmSendJsonRpcRequest;
    confirmedTransaction: Transaction;
    amount: BigNumber;
  }): Promise<{
    wallet: ResolvedActivatedAccount['wallet'];
    onChainAccount: ResolvedActivatedAccount['onChainAccount'];
    transaction: Transaction;
  }> {
    const { request, confirmedTransaction, amount } = params;
    const { assetId, toAddress, scope } = request.params;
    // Resolve again after the user confirms so sequence, balances, and fees are fresh before signing.
    // sendTransaction still handles txBadSeq races that happen after this refresh.
    const { wallet, onChainAccount } = await this.resolveAccount(request);

    const refreshedTransaction =
      await this.#transactionService.createValidatedSendTransaction({
        onChainAccount,
        scope,
        assetId,
        amount,
        destination: toAddress,
      });

    // Reject if the refreshed fee is higher than what the user approved, so we
    // never sign a transaction that differs from what was shown on the confirmation screen.
    assertRefreshedTransactionFeeNotHigher({
      confirmedTransaction,
      refreshedTransaction,
    });

    return {
      wallet,
      onChainAccount,
      transaction: refreshedTransaction,
    };
  }

  async #confirmSend(params: {
    request: ConfirmSendJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    scope: KnownCaip2ChainId;
    fee: BigNumber;
    transaction: Transaction;
  }): Promise<boolean> {
    const { request, account, assetMetadata, fee, scope, transaction } = params;
    const { toAddress, amount, assetId } = request.params;
    const xdr = transaction.getRaw().toXDR();

    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope,
        origin: METAMASK_ORIGIN,
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
          scanTxn: true,
          validateTxn: true,
        },
        securityScanRequest: {
          accountAddress: account.address,
          transaction: xdr,
        },
        transactionValidationRequest: {
          accountId: account.id,
          transaction: xdr,
          request,
        },
        tokenPrices: {
          [assetId]: null,
        } as ContextWithPrices['tokenPrices'],
      })) === true
    );
  }

  /**
   * Override the base handler to return invalid when the account is not activated.
   * Instead of showing the account not activated alert, it returns an invalid response.
   *
   * @param _error - The error to handle.
   * @param _request - The JSON-RPC request (unused for this handler).
   * @returns The invalid response when the account is not activated.
   */
  protected override async handleAccountNotActivatedError(
    _error: AccountNotActivatedException,
    _request: ConfirmSendJsonRpcRequest,
  ): Promise<ConfirmSendJsonRpcResponse> {
    return {
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    };
  }
}
