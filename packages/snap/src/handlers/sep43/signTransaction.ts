import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type {
  Sep43SignTransactionRequest,
  Sep43SignTransactionResponse,
} from './api';
import { Sep43SignTransactionRequestStruct } from './api';
import { BaseSep43Handler } from './base';
import type { Sep43Error } from './exceptions';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type {
  Transaction,
  TransactionBuilder,
  TransactionService,
} from '../../services/transaction';
import { OperationMapper } from '../../services/transaction';
import {
  assertAccountInvolvesTransaction,
  assertTransactionScope,
  collectTransactionAssetCaipIds,
} from '../../services/transaction/utils';
import type { Wallet, WalletService } from '../../services/wallet';
import type { ContextWithPrices } from '../../ui/confirmation/api';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils';

/**
 * SEP-43 `SignTransaction` handler.
 *
 * Reuses the existing sign-transaction confirmation view via {@link ConfirmationUXController}.
 * Returns the SEP-43 response shape (`signedTxXdr`, `signerAddress`, optional `error`)
 * and never throws to the dapp — failures are wrapped in the `error` envelope by the base.
 */
export class Sep43SignTransactionHandler extends BaseSep43Handler<
  Sep43SignTransactionRequest,
  Sep43SignTransactionResponse
> {
  readonly #transactionBuilder: TransactionBuilder;

  readonly #transactionService: TransactionService;

  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    walletService,
    transactionBuilder,
    transactionService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    transactionBuilder: TransactionBuilder;
    transactionService: TransactionService;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountService,
      walletService,
      loggerPrefix: '[📝 Sep43SignTransactionHandler]',
      requestStruct: Sep43SignTransactionRequestStruct,
    });
    this.#transactionBuilder = transactionBuilder;
    this.#transactionService = transactionService;
    this.#confirmationUIController = confirmationUIController;
  }

  protected async execute(
    request: Sep43SignTransactionRequest,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<Sep43SignTransactionResponse> {
    const { account, wallet } = resolved;
    const { scope } = request;
    const { xdr } = request.request.params;

    // Deserializing validates that the transaction is well-formed and scope-compatible.
    const transaction = this.#transactionBuilder.deserialize({ xdr, scope });

    assertTransactionScope(transaction, scope);
    assertAccountInvolvesTransaction(transaction, wallet.address);

    const transactionWithFee =
      await this.#transactionService.computingFee(transaction);

    if (!(await this.#confirm(request, transactionWithFee, account))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    wallet.signTransaction(transactionWithFee);
    const signedTxXdr = transactionWithFee.getRaw().toXDR();

    return {
      signedTxXdr,
      signerAddress: account.address,
    };
  }

  protected toErrorResponse(
    signerAddress: string,
    error: Sep43Error,
  ): Sep43SignTransactionResponse {
    return {
      // SEP-43 schema requires the field even on error; keep it empty when unknown.
      signedTxXdr: '',
      signerAddress,
      error: error.toEnvelope(),
    };
  }

  async #confirm(
    request: Sep43SignTransactionRequest,
    transaction: Transaction,
    account: StellarKeyringAccount,
  ): Promise<boolean> {
    const readableTransaction = new OperationMapper().mapTransaction(
      transaction,
    );

    // Seed every asset id we render so the cron refresh updates prices for all of them.
    // The `as` cast bypasses superstruct typing that requires every union key.
    const tokenPrices = Object.fromEntries(
      collectTransactionAssetCaipIds(request.scope, readableTransaction).map(
        (assetId) => [assetId, null] as const,
      ),
    ) as ContextWithPrices['tokenPrices'];

    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope: request.scope,
        origin: request.origin,
        interfaceKey: ConfirmationInterfaceKey.SignTransaction,
        fee: readableTransaction.feeStroops,
        renderContext: {
          readableTransaction,
          account,
        },
        renderOptions: { loadPrice: true },
        tokenPrices,
      })) === true
    );
  }
}
