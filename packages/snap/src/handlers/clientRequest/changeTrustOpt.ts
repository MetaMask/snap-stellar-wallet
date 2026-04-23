import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { ensureError } from '@metamask/utils';

import type {
  ChangeTrustOptJsonRpcRequest,
  ChangeTrustOptJsonRpcResponse,
} from './api';
import {
  ChangeTrustOptAction,
  ChangeTrustOptJsonRpcRequestStruct,
  ChangeTrustOptJsonRpcResponseStruct,
} from './api';
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type {
  AssetMetadataService,
  StellarAssetMetadata,
} from '../../services/asset-metadata';
import type { OnChainAccountService } from '../../services/on-chain-account';
import {
  TrustlineNotFoundException,
  KeyringTransactionType,
} from '../../services/transaction';
import type { TransactionService } from '../../services/transaction';
import type { WalletService } from '../../services/wallet';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { createPrefixedLogger, type ILogger } from '../../utils/logger';

export class ChangeTrustOptHandler extends WithClientRequestActiveAccountResolve<
  ChangeTrustOptJsonRpcRequest,
  ChangeTrustOptJsonRpcResponse
> {
  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    transactionService,
    assetMetadataService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    assetMetadataService: AssetMetadataService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
    transactionService: TransactionService;
    confirmationUIController: ConfirmationUXController;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[💼 ChangeTrustOptHandler]',
    );
    super({
      accountService,
      onChainAccountService,
      walletService,
      logger: prefixedLogger,
      requestStruct: ChangeTrustOptJsonRpcRequestStruct,
      responseStruct: ChangeTrustOptJsonRpcResponseStruct,
    });
    this.#transactionService = transactionService;
    this.#assetMetadataService = assetMetadataService;
    this.#confirmationUIController = confirmationUIController;
  }

  /**
   * Handles trustline opt-in/opt-out requests.
   *
   * @param resolvedAccount - The resolved and activated account.
   * @param request - JSON-RPC request containing `scope`, `assetId`, `action`, and optional `limit`.
   * @returns A `ChangeTrustOptJsonRpcResponse`:
   * - `{ status: true, transactionId }` when the transaction is built, signed, and submitted.
   * - `{ status: true }` when preflight finds an existing classic trustline with limit greater than zero for an add request.
   * @throws {TrustlineNotFoundException} If a delete request targets a trustline that does not exist.
   * @throws {UserRejectedRequestError} If the user rejects the confirmation prompt.
   */
  protected async _handle(
    resolvedAccount: ResolvedActivatedAccount,
    request: ChangeTrustOptJsonRpcRequest,
  ): Promise<ChangeTrustOptJsonRpcResponse> {
    const { scope, assetId, action } = request.params;
    const { wallet, account, onChainAccount } = resolvedAccount;

    // Quit early if add is redundant (classic line already present with limit > 0)
    if (action === ChangeTrustOptAction.Add) {
      const asset = onChainAccount.getAsset(assetId);
      if (asset?.limit?.gt(0)) {
        return {
          status: true,
        };
      }
    }

    // Quit early if the trustline does not exist for delete
    if (
      action === ChangeTrustOptAction.Delete &&
      !onChainAccount.hasAsset(assetId)
    ) {
      throw new TrustlineNotFoundException(assetId, onChainAccount.accountId);
    }

    // Safeguard to ensure we use the correct limit for delete
    const limitForTx =
      action === ChangeTrustOptAction.Delete ? '0' : request.params.limit;

    const assetMetadata = await this.#assetMetadataService.resolve(assetId);

    const transaction =
      await this.#transactionService.createValidatedChangeTrustTransaction({
        onChainAccount,
        assetId,
        scope,
        limit: limitForTx,
      });

    const confirmed = await this.#confirmChangeTrustOpt({
      request,
      account,
      assetMetadata,
      fee: transaction.totalFee.toString(),
      action,
    });

    if (!confirmed) {
      throw ensureError(new UserRejectedRequestError());
    }

    wallet.signTransaction(transaction);

    const transactionId = await this.#transactionService.sendTransaction({
      wallet,
      onChainAccount,
      scope,
      transaction,
    });

    await this.#savePendingTransaction({
      transactionId,
      scope,
      assetId,
      account,
      assetMetadata,
      action,
    });

    return {
      status: true,
      transactionId,
    };
  }

  async #savePendingTransaction(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19AssetIdOrSlip44Id;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    action: ChangeTrustOptAction;
  }): Promise<void> {
    try {
      const { transactionId, scope, assetId, account, assetMetadata, action } =
        params;
      await this.#transactionService.savePendingKeyringTransaction({
        type:
          action === ChangeTrustOptAction.Add
            ? KeyringTransactionType.ChangeTrustOptIn
            : KeyringTransactionType.ChangeTrustOptOut,
        request: {
          txId: transactionId,
          account,
          scope,
          asset: {
            type: assetId,
            symbol: assetMetadata.symbol,
          },
        },
      });
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'Failed to save pending transaction',
        error,
      );
      // we should not throw error here, as we want to continue the flow even if the pending transaction is not saved
    }
  }

  async #confirmChangeTrustOpt(params: {
    request: ChangeTrustOptJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    fee: string;
    action: ChangeTrustOptAction;
  }): Promise<boolean> {
    return params.action === ChangeTrustOptAction.Delete
      ? await this.#confirmSignChangeTrustOptOut(params)
      : await this.#confirmSignChangeTrustOptIn(params);
  }

  async #confirmSignChangeTrustOptIn(params: {
    request: ChangeTrustOptJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    fee: string;
  }): Promise<boolean> {
    return this.#confirmSignChangeTrust({
      ...params,
      confirmationInterfaceKey: ConfirmationInterfaceKey.ChangeTrustlineOptIn,
    });
  }

  async #confirmSignChangeTrustOptOut(params: {
    request: ChangeTrustOptJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    fee: string;
  }): Promise<boolean> {
    return this.#confirmSignChangeTrust({
      ...params,
      confirmationInterfaceKey: ConfirmationInterfaceKey.ChangeTrustlineOptOut,
    });
  }

  async #confirmSignChangeTrust(params: {
    request: ChangeTrustOptJsonRpcRequest;
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    fee: string;
    confirmationInterfaceKey:
      | ConfirmationInterfaceKey.ChangeTrustlineOptIn
      | ConfirmationInterfaceKey.ChangeTrustlineOptOut;
  }): Promise<boolean> {
    const {
      request: {
        params: { scope },
      },
      account,
      assetMetadata,
      fee,
      confirmationInterfaceKey,
    } = params;
    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope,
        renderContext: {
          account,
          assetMetadata,
        },
        fee,
        interfaceKey: confirmationInterfaceKey,
        renderOptions: {
          loadPrice: true,
        },
      })) === true
    );
  }
}
