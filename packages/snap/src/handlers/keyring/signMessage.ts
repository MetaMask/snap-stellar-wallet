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
import { render } from '../../ui/confirmation/views/ConfirmSignMessage/render';
import type { ILogger } from '../../utils';

type SignMessageResolveOpts = { onChainAccount: false; wallet: true };

export class SignMessageHandler extends WithKeyringRequestActiveAccountResolve<
  SignMessageRequest,
  SignMessageResponse,
  SignMessageResolveOpts
> {
  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
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
  }

  protected async _handle(
    resolved: ResolvedActivatedAccountFor<SignMessageResolveOpts>,
    request: SignMessageRequest,
  ): Promise<SignMessageResponse> {
    const { wallet, account } = resolved;

    if (!(await this.#confrimation(request, account))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const { message } = request.request.params;

    const signature = await wallet.signMessage(message);

    return { signature };
  }

  async #confrimation(
    request: SignMessageRequest,
    account: StellarKeyringAccount,
  ): Promise<boolean> {
    return (await render(request, account)) === true;
  }
}
