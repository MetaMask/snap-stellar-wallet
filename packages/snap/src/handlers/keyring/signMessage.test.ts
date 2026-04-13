import { UserRejectedRequestError } from '@metamask/snaps-sdk';

import { MultichainMethod, type SignMessageRequest } from './api';
import { SignMessageHandler } from './signMessage';
import { KnownCaip2ChainId } from '../../api';
import type { StellarKeyringAccount } from '../../services/account';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { render as confirmSignMessageRender } from '../../ui/confirmation/views/ConfirmSignMessage/render';
import { logger } from '../../utils/logger';

jest.mock('../../ui/confirmation/views/ConfirmSignMessage/render', () => ({
  render: jest.fn(),
}));

jest.mock('../../utils/logger');

describe('SignMessageHandler', () => {
  const keyringRequestId = '11111111-1111-4111-8111-111111111111';

  const encodedMessage = btoa('hello stellar');

  const buildRequest = (
    account: StellarKeyringAccount,
  ): SignMessageRequest => ({
    id: keyringRequestId,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: account.id,
    request: {
      method: MultichainMethod.SignMessage,
      params: { message: encodedMessage },
    },
  });

  /**
   * Builds a {@link SignMessageHandler} with mocked account/wallet resolution.
   *
   * @returns Handler instance, resolved keyring account, and test wallet.
   */
  function setupSignMessageHandler(): {
    handler: SignMessageHandler;
    mockAccount: StellarKeyringAccount;
    wallet: ReturnType<typeof getTestWallet>;
  } {
    const wallet = getTestWallet();
    const mockAccount = generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      wallet.address,
      'entropy-source-1',
      0,
    );

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();

    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: mockAccount,
    });

    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const handler = new SignMessageHandler({
      logger,
      accountService,
      onChainAccountService,
      walletService,
    });

    return { handler, mockAccount, wallet };
  }

  it('returns signature when confirmation accepts', async () => {
    const { handler, mockAccount, wallet } = setupSignMessageHandler();
    jest.mocked(confirmSignMessageRender).mockResolvedValue(true);

    const request = buildRequest(mockAccount);
    const result = await handler.handle(request);

    const expectedSignature = await wallet.signMessage(encodedMessage);

    expect(confirmSignMessageRender).toHaveBeenCalledTimes(1);
    expect(confirmSignMessageRender).toHaveBeenCalledWith(request, mockAccount);
    expect(result).toStrictEqual({ signature: expectedSignature });
  });

  it('throws when confirmation rejects', async () => {
    const { handler, mockAccount } = setupSignMessageHandler();
    jest.mocked(confirmSignMessageRender).mockResolvedValue(false);

    const request = buildRequest(mockAccount);

    await expect(handler.handle(request)).rejects.toThrow(
      UserRejectedRequestError,
    );

    expect(confirmSignMessageRender).toHaveBeenCalledWith(request, mockAccount);
  });

  it('rejects invalid requests before calling render', async () => {
    const { handler, mockAccount } = setupSignMessageHandler();
    jest.mocked(confirmSignMessageRender).mockResolvedValue(true);

    await expect(
      handler.handle({
        ...buildRequest(mockAccount),
        request: {
          method: MultichainMethod.SignMessage,
          params: { message: '' },
        },
      }),
    ).rejects.toThrow(/request\.params\.message/u);

    expect(confirmSignMessageRender).not.toHaveBeenCalled();
  });
});
