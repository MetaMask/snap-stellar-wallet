import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type { SignTransactionRequest, SignTransactionResponse } from './api';
import {
  SignTransactionRequestStruct,
  SignTransactionResponseStruct,
} from './api';
import { BaseSep43KeyringHandler } from './base';
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
 * SEP-43 `signTransaction` keyring handler.
 *
 * Reuses the existing sign-transaction confirmation view via
 * {@link ConfirmationUXController}. Returns the SEP-43 response shape
 * (`signedTxXdr`, `signerAddress`, optional `error`) and never throws to the
 * dapp — failures are wrapped in the `error` envelope by the base.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export class SignTransactionHandler extends BaseSep43KeyringHandler<
  SignTransactionRequest,
  SignTransactionResponse
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
      loggerPrefix: '[📝 SignTransactionHandler]',
      requestStruct: SignTransactionRequestStruct,
      responseStruct: SignTransactionResponseStruct,
    });
    this.#transactionBuilder = transactionBuilder;
    this.#transactionService = transactionService;
    this.#confirmationUIController = confirmationUIController;
  }

  protected async execute(
    request: SignTransactionRequest,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<SignTransactionResponse> {
    const { account, wallet } = resolved;
    const { scope } = request;
    const { xdr } = request.request.params;

    // Deserializing validates that the transaction is well-formed and scope-compatible.
    // We intentionally skip balance and operation-level checks here;
    // callers must validate those before requesting a signature.
    const transaction = this.#transactionBuilder.deserialize({ xdr, scope });

    // verify the transaction scope matches the requested scope
    assertTransactionScope(transaction, scope);
    // The signer may not be the tx source of the transaction,
    // but it must participate as fee source (fee bump), or op source.
    // We gate signing to envelopes that involve this wallet.
    assertAccountInvolvesTransaction(transaction, wallet.address);

    // Computing fee will inject the fee into the transaction
    const transactionWithFee =
      await this.#transactionService.computingFee(transaction);

    if (!(await this.#confirmation(request, transactionWithFee, account))) {
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
  ): SignTransactionResponse {
    return {
      // SEP-43 schema requires the field even on error; keep it empty when unknown.
      signedTxXdr: '',
      signerAddress,
      error: error.toEnvelope(),
    };
  }

  async #confirmation(
    request: SignTransactionRequest,
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
