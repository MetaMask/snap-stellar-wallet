import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type { SignTransactionRequest, SignTransactionResponse } from './api';
import {
  SignTransactionRequestStruct,
  SignTransactionResponseStruct,
} from './api';
import type { AccountResolver } from '../accountResolver';
import { BaseSep43KeyringHandler } from './base';
import type { Sep43Error } from './exceptions';
import type { StellarKeyringAccount } from '../../services/account';
import { OperationMapper, Transaction } from '../../services/transaction';
import {
  assertTransactionScope,
  collectTransactionAssetCaipIds,
} from '../../services/transaction/utils';
import type { Wallet } from '../../services/wallet';
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
  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountResolver,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountResolver,
      loggerPrefix: '[📝 SignTransactionHandler]',
      requestStruct: SignTransactionRequestStruct,
      responseStruct: SignTransactionResponseStruct,
    });
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
    const transaction = Transaction.fromXdr({ xdr, scope });

    // verify the transaction scope matches the requested scope
    assertTransactionScope(transaction, scope);

    // We do not process RPC simulation here, we trust the fee that provided by the dapp.
    // If the transaction is invalid, the security scan will output the error.
    if (!(await this.#confirmation(request, transaction, account))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    wallet.signTransaction(transaction);
    const signedTxXdr = transaction.getRaw().toXDR();

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
      error: error.toJSON(),
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

    // Sign-transaction estimated changes come entirely from remote Blockaid
    // simulation; the scan refresher fills them in once the scan returns.
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
        renderOptions: {
          loadPrice: true,
          securityScanning: true,
          remoteSimulation: true,
        },
        securityScanRequest: {
          accountAddress: account.address,
          transaction: transaction.getRaw().toXDR(),
        },
        tokenPrices,
      })) === true
    );
  }
}
