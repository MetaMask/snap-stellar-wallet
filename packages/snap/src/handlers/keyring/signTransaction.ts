import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { ensureError } from '@metamask/utils';

import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { ResolvedActivatedAccount } from '../base';
import type { SignTransactionRequest, SignTransactionResponse } from './api';
import {
  SignTransactionRequestStruct,
  SignTransactionResponseStruct,
} from './api';
import { WithKeyringRequestActiveAccountResolve } from './base';
import type {
  TransactionBuilder,
  Transaction,
  TransactionService,
} from '../../services/transaction';
import { OperationMapper } from '../../services/transaction';
import {
  assertTransactionScope,
  assertAccountInvolvesTransaction,
  collectTransactionAssetCaipIds,
} from '../../services/transaction/utils';
import type { WalletService } from '../../services/wallet';
import type { ContextWithPrices } from '../../ui/confirmation/api';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils';

export class SignTransactionHandler extends WithKeyringRequestActiveAccountResolve<
  SignTransactionRequest,
  SignTransactionResponse
> {
  readonly #transactionBuilder: TransactionBuilder;

  readonly #transactionService: TransactionService;

  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    transactionBuilder,
    transactionService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
    walletService: WalletService;
    transactionBuilder: TransactionBuilder;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountService,
      onChainAccountService,
      walletService,
      requestStruct: SignTransactionRequestStruct,
      responseStruct: SignTransactionResponseStruct,
      resolveAccountOptions: { onChainAccount: false },
    });
    this.#transactionBuilder = transactionBuilder;
    this.#transactionService = transactionService;
    this.#confirmationUIController = confirmationUIController;
  }

  protected async _handle(
    resolved: ResolvedActivatedAccount,
    request: SignTransactionRequest,
  ): Promise<SignTransactionResponse> {
    const { wallet, account } = resolved;
    const { scope } = request;
    const { transaction: transactionBase64Xdr } = request.request.params;

    // Deserializing validates that the transaction is well-formed and scope-compatible.
    // We intentionally skip balance and operation-level checks here;
    // callers must validate those before requesting a signature.
    const transaction = this.#transactionBuilder.deserialize({
      xdr: transactionBase64Xdr,
      scope,
    });

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
      throw ensureError(new UserRejectedRequestError());
    }

    wallet.signTransaction(transactionWithFee);

    const signature = transactionWithFee.getRaw().toXDR();

    return { signature };
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
