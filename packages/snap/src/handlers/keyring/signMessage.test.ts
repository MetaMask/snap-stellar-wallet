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
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

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
    renderConfirmationDialog: jest.Mock;
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

    const renderConfirmationDialog = jest.fn();
    const confirmationUIController = {
      renderConfirmationDialog,
    } as Pick<
      ConfirmationUXController,
      'renderConfirmationDialog'
    > as unknown as ConfirmationUXController;

    const handler = new SignMessageHandler({
      logger,
      accountService,
      onChainAccountService,
      walletService,
      confirmationUIController,
    });

    return { handler, mockAccount, wallet, renderConfirmationDialog };
  }

  it('returns signature when confirmation accepts', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupSignMessageHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    const request = buildRequest(mockAccount);
    const result = await handler.handle(request);

    const expectedSignature = await wallet.signMessage(encodedMessage);

    expect(renderConfirmationDialog).toHaveBeenCalledTimes(1);
    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: request.scope,
        origin: request.origin,
        interfaceKey: ConfirmationInterfaceKey.SignMessage,
        renderContext: expect.objectContaining({
          account: mockAccount,
          message: 'hello stellar',
        }),
      }),
    );
    expect(result).toStrictEqual({ signature: expectedSignature });
  });

  it('throws when confirmation rejects', async () => {
    const { handler, mockAccount, renderConfirmationDialog } =
      setupSignMessageHandler();
    renderConfirmationDialog.mockResolvedValue(false);

    const request = buildRequest(mockAccount);

    await expect(handler.handle(request)).rejects.toThrow(
      UserRejectedRequestError,
    );

    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: request.scope,
        origin: request.origin,
        interfaceKey: ConfirmationInterfaceKey.SignMessage,
        renderContext: expect.objectContaining({
          account: mockAccount,
          message: 'hello stellar',
        }),
      }),
    );
  });

  it('rejects invalid requests before calling render', async () => {
    const { handler, mockAccount, renderConfirmationDialog } =
      setupSignMessageHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    await expect(
      handler.handle({
        ...buildRequest(mockAccount),
        request: {
          method: MultichainMethod.SignMessage,
          params: { message: '' },
        },
      }),
    ).rejects.toThrow(/request\.params\.message/u);

    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });
});
