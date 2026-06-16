import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type { SignTransactionRequest, SignTransactionResponse } from './api';
import {
  SignTransactionRequestStruct,
  SignTransactionResponseStruct,
} from './api';
import type { AccountResolver } from '../accountResolver';
import { ResolveAccountSource } from '../accountResolver';
import { BaseSep43KeyringHandler } from './base';
import type { Sep43Error } from './exceptions';
import type { StellarKeyringAccount } from '../../services/account';
import type { TransactionService } from '../../services/transaction';
import { OperationMapper, Transaction } from '../../services/transaction';
import {
  assertAccountInvolvesTransaction,
  assertTransactionScope,
  assertTransactionTimeBound,
  collectTransactionAssetCaipIds,
} from '../../services/transaction/utils';
import type { TransactionScanEstimatedChanges } from '../../services/transaction-scan';
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
  readonly #transactionService: TransactionService;

  readonly #confirmationUIController: ConfirmationUXController;

  readonly #accountResolver: AccountResolver;

  constructor({
    logger,
    accountResolver,
    transactionService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    transactionService: TransactionService;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountResolver,
      loggerPrefix: '[📝 SignTransactionHandler]',
      requestStruct: SignTransactionRequestStruct,
      responseStruct: SignTransactionResponseStruct,
    });
    this.#transactionService = transactionService;
    this.#confirmationUIController = confirmationUIController;
    this.#accountResolver = accountResolver;
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
    // The signer may not be the tx source of the transaction,
    // but it must participate as fee source (fee bump), or op source.
    // We gate signing to envelopes that involve this wallet.
    assertAccountInvolvesTransaction(transaction, wallet.address);

    // Ensure the transaction has not expired
    assertTransactionTimeBound(transaction);

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

    // Estimated balance changes come from local on-chain simulation (not the
    // remote security scan), so they render immediately on dialog open. The
    // remote scan only contributes security validation.
    const estimatedChanges = await this.#deriveEstimatedChanges(
      request,
      transaction,
      account,
    );

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
        renderOptions: { loadPrice: true, scanTxn: true },
        securityScanRequest: {
          accountAddress: account.address,
          transaction: transaction.getRaw().toXDR(),
        },
        initialScan: {
          status: 'SUCCESS',
          estimatedChanges,
          validation: null,
          error: null,
        },
        tokenPrices,
      })) === true
    );
  }

  /**
   * Best-effort local simulation of the signer's balance changes. Resolves the
   * on-chain account and runs the local simulator; any failure (account not
   * activated, unsupported/Soroban transaction, network error) resolves to an
   * empty result so the confirmation simply hides the estimated-changes section.
   *
   * @param request - The validated sign-transaction request.
   * @param transaction - The transaction with fee already applied.
   * @param account - The resolved keyring account.
   * @returns The estimated changes, or `{ assets: [] }` when unavailable.
   */
  async #deriveEstimatedChanges(
    request: SignTransactionRequest,
    transaction: Transaction,
    account: StellarKeyringAccount,
  ): Promise<TransactionScanEstimatedChanges> {
    try {
      const { onChainAccount } = await this.#accountResolver.resolveAccount({
        accountId: account.id,
        scope: request.scope,
        options: {
          onChainAccount: { load: true, source: ResolveAccountSource.OnChain },
          wallet: false,
        },
      });

      return await this.#transactionService.deriveEstimatedChanges({
        transaction,
        onChainAccount,
        signerAddress: account.address,
      });
    } catch (error) {
      this.logger.logErrorWithDetails(
        'Failed to derive estimated changes for sign transaction',
        error,
      );
      return { assets: [] };
    }
  }
}
