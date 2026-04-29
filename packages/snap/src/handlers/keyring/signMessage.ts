import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type { SignMessageRequest, SignMessageResponse } from './api';
import { SignMessageRequestStruct, SignMessageResponseStruct } from './api';
import { BaseSep43KeyringHandler } from './base';
import type { Sep43Error } from './exceptions';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { Wallet, WalletService } from '../../services/wallet';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils';
import { bufferToUint8Array } from '../../utils';
import { isBase64 } from '../../utils/string';

/**
 * SEP-43 `signMessage` keyring handler.
 *
 * Reuses the existing sign-message confirmation view via
 * {@link ConfirmationUXController}. Returns the SEP-43 response shape
 * (`signedMessage`, `signerAddress`, optional `error`) and never throws to the
 * dapp — failures are wrapped in the `error` envelope by the base.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export class SignMessageHandler extends BaseSep43KeyringHandler<
  SignMessageRequest,
  SignMessageResponse
> {
  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    walletService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountService,
      walletService,
      loggerPrefix: '[✉️ SignMessageHandler]',
      requestStruct: SignMessageRequestStruct,
      responseStruct: SignMessageResponseStruct,
    });
    this.#confirmationUIController = confirmationUIController;
  }

  protected async execute(
    request: SignMessageRequest,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<SignMessageResponse> {
    const { account, wallet } = resolved;
    const { message } = request.request.params;

    if (!(await this.#confirm(request, account, message))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const signedMessage = await wallet.signMessage(message);

    return {
      signedMessage,
      signerAddress: account.address,
    };
  }

  protected toErrorResponse(
    signerAddress: string,
    error: Sep43Error,
  ): SignMessageResponse {
    return {
      // SEP-43 schema requires the field even on error; keep it empty when unknown.
      signedMessage: '',
      signerAddress,
      error: error.toJSON(),
    };
  }

  async #confirm(
    request: SignMessageRequest,
    account: StellarKeyringAccount,
    message: string,
  ): Promise<boolean> {
    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope: request.scope,
        renderContext: {
          account,
          message: this.#getUtf8Message(message),
        },
        origin: request.origin,
        interfaceKey: ConfirmationInterfaceKey.SignMessage,
      })) === true
    );
  }

  /**
   * Resolves the message to a UTF-8 string for display in the confirmation
   * dialog. SEP-43 accepts either base64-encoded bytes or UTF-8 text — we
   * mirror the wallet's detection so the user sees the same content that
   * gets signed.
   *
   * @param message - The raw message string from the request.
   * @returns The message interpreted as UTF-8 text for the UI.
   */
  #getUtf8Message(message: string): string {
    return isBase64(message)
      ? bufferToUint8Array(message, 'base64').toString('utf8')
      : message;
  }
}
