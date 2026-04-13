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
import {
  assertTransactionScope,
  assertAccountInvolvesTransaction,
} from '../../services/transaction/utils';
import type { WalletService } from '../../services/wallet';
import { render } from '../../ui/confirmation/views/ConfirmSignTransaction/render';
import type { ILogger } from '../../utils';

export class SignTransactionHandler extends WithKeyringRequestActiveAccountResolve<
  SignTransactionRequest,
  SignTransactionResponse
> {
  readonly #transactionBuilder: TransactionBuilder;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    transactionBuilder,
    transactionService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
    walletService: WalletService;
    transactionBuilder: TransactionBuilder;
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
    return (await render(request, transaction, account)) === true;
  }
}
