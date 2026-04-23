import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type { Sep43SignMessageRequest, Sep43SignMessageResponse } from './api';
import { Sep43SignMessageRequestStruct } from './api';
import { BaseSep43Handler } from './base';
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
 * SEP-43 `SignMessage` handler.
 *
 * Reuses the existing sign-message confirmation view via {@link ConfirmationUXController}.
 * Returns the SEP-43 response shape (`signedMessage`, `signerAddress`, optional `error`)
 * and never throws to the dapp — failures are wrapped in the `error` envelope by the base.
 */
export class Sep43SignMessageHandler extends BaseSep43Handler<
  Sep43SignMessageRequest,
  Sep43SignMessageResponse
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
      loggerPrefix: '[✉️ Sep43SignMessageHandler]',
      requestStruct: Sep43SignMessageRequestStruct,
    });
    this.#confirmationUIController = confirmationUIController;
  }

  protected async execute(
    request: Sep43SignMessageRequest,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<Sep43SignMessageResponse> {
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
  ): Sep43SignMessageResponse {
    return {
      // SEP-43 schema requires the field even on error; keep it empty when unknown.
      signedMessage: '',
      signerAddress,
      error: error.toEnvelope(),
    };
  }

  async #confirm(
    request: Sep43SignMessageRequest,
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

  #getUtf8Message(message: string): string {
    if (isBase64(message)) {
      return bufferToUint8Array(message, 'base64').toString('utf8');
    }
    return message;
  }
}
