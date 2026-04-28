import { Networks } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignMessageRequest } from './api';
import { Sep43ErrorCode } from './exceptions';
import { SignMessageHandler } from './signMessage';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import {
  generateStellarKeyringAccount,
  mockAccountService,
} from '../../services/account/__mocks__/account.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('SignMessageHandler', () => {
  /**
   * Builds a {@link SignMessageHandler} with mocked account / wallet
   * resolution and a stubbed `ConfirmationUXController`.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupHandler() {
    const wallet = getTestWallet();
    const accountId = globalThis.crypto.randomUUID();
    const mockAccount = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );

    const { accountService, walletService } = mockAccountService();

    jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account: mockAccount });

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
      walletService,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      renderConfirmationDialog,
    };
  }

  const buildRequest = (
    accountId: string,
    overrides: Partial<SignMessageRequest['request']['params']> = {},
  ): SignMessageRequest => ({
    id: '11111111-1111-4111-8111-111111111111',
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: accountId,
    request: {
      method: MultichainMethod.SignMessage,
      params: {
        message: btoa('hello stellar'),
        ...overrides,
      },
    },
  });

  it('returns signedMessage and signerAddress on confirm', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    const result = await handler.handle(buildRequest(mockAccount.id));

    const expected = await wallet.signMessage(btoa('hello stellar'));
    expect(result).toStrictEqual({
      signedMessage: expected,
      signerAddress: wallet.address,
    });
  });

  it('returns error -4 when user rejects', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(false);

    const result = await handler.handle(buildRequest(mockAccount.id));

    expect(result).toMatchObject({
      signedMessage: '',
      signerAddress: wallet.address,
      error: { code: Sep43ErrorCode.UserRejected },
    });
  });

  it('returns error -3 when scope is testnet', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle({
      ...buildRequest(mockAccount.id),
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result).toMatchObject({
      signedMessage: '',
      signerAddress: '',
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.networkPassphrase is not the mainnet passphrase', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, {
        opts: { networkPassphrase: Networks.TESTNET },
      }),
    );

    expect(result).toMatchObject({
      error: {
        code: Sep43ErrorCode.InvalidRequest,
        ext: [expect.stringContaining('mainnet')],
      },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it.each([
    ['opts.submit', { submit: true }],
    ['opts.submitUrl', { submitUrl: 'https://horizon.stellar.org' }],
  ])('returns error -3 when %s is provided', async (_label, forbiddenOpts) => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const base = buildRequest(mockAccount.id);
    // Inject the forbidden opt bypassing the struct type so we can assert the
    // handler rejects it at runtime with -3 InvalidRequest.
    (base.request.params as unknown as { opts: Record<string, unknown> }).opts =
      forbiddenOpts;

    const result = await handler.handle(base);

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('signs a non-base64 string as UTF-8 text', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    const utf8Message = 'Sign in to dapp';
    const result = await handler.handle(
      buildRequest(mockAccount.id, { message: utf8Message }),
    );

    const expected = await wallet.signMessage(utf8Message);
    expect(result).toStrictEqual({
      signedMessage: expected,
      signerAddress: wallet.address,
    });
  });
});
