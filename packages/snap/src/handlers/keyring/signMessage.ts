import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { WalletService } from '../../services/wallet';
import type { ResolvedActivatedAccountFor } from '../base';
import type { SignMessageRequest, SignMessageResponse } from './api';
import { SignMessageRequestStruct, SignMessageResponseStruct } from './api';
import { WithKeyringRequestActiveAccountResolve } from './base';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { bufferToUint8Array, type ILogger } from '../../utils';
import { isBase64 } from '../../utils/string';

type SignMessageResolveOpts = { onChainAccount: false; wallet: true };

export class SignMessageHandler extends WithKeyringRequestActiveAccountResolve<
  SignMessageRequest,
  SignMessageResponse,
  SignMessageResolveOpts
> {
  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountService,
      onChainAccountService,
      walletService,
      requestStruct: SignMessageRequestStruct,
      responseStruct: SignMessageResponseStruct,
      resolveAccountOptions: { onChainAccount: false },
    });
    this.#confirmationUIController = confirmationUIController;
  }

  protected async _handle(
    resolved: ResolvedActivatedAccountFor<SignMessageResolveOpts>,
    request: SignMessageRequest,
  ): Promise<SignMessageResponse> {
    const { wallet, account } = resolved;

    if (!(await this.#confirmation(request, account))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const { message } = request.request.params;

    const signature = await wallet.signMessage(message);

    return { signature };
  }

  async #confirmation(
    request: SignMessageRequest,
    account: StellarKeyringAccount,
  ): Promise<boolean> {
    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope: request.scope,
        renderContext: {
          account,
          message: this.#getUtf8Message(request.request.params.message),
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
