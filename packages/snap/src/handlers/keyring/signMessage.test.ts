import { Networks } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignMessageRequest } from './api';
import { Sep43ErrorCode } from './exceptions';
import { SignMessageHandler } from './signMessage';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { AccountNotFoundException } from '../../services/account/exceptions';
import { AccountNotActivatedException } from '../../services/network';
import { OnChainAccountService } from '../../services/on-chain-account';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');
/* eslint-disable @typescript-eslint/naming-convention -- Jest ESM interop */
jest.mock('../../ui/confirmation/views/AccountActivationPrompt/render', () => ({
  __esModule: true,
  render: jest.fn().mockResolvedValue(undefined),
}));
/* eslint-enable @typescript-eslint/naming-convention */

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

    const { accountService, walletService, onChainAccountService } =
      mockOnChainAccountService();

    const resolveOnChainAccountSpy = jest
      .spyOn(OnChainAccountService.prototype, 'resolveOnChainAccount')
      .mockResolvedValue({ assetIds: [] } as unknown as OnChainAccount);

    const resolveAccountSpy = jest
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
      onChainAccountService,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      renderConfirmationDialog,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
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

    expect(result.signedMessage).toBe('');
    expect(result.signerAddress).toBe(wallet.address);
    expect(result.error?.code).toBe(Sep43ErrorCode.UserRejected);
  });

  it('returns error -3 when scope is testnet', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle({
      ...buildRequest(mockAccount.id),
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result.signedMessage).toBe('');
    expect(result.signerAddress).toBe('');
    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.networkPassphrase is not the mainnet passphrase', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, {
        opts: { networkPassphrase: Networks.TESTNET },
      }),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(result.error?.ext?.[0]).toContain('mainnet');
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

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.address cannot be resolved', async () => {
    const { handler, mockAccount, resolveAccountSpy } = setupHandler();
    const unknownAddress =
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    resolveAccountSpy.mockRejectedValueOnce(
      new AccountNotFoundException(unknownAddress),
    );

    const result = await handler.handle(
      buildRequest(mockAccount.id, { opts: { address: unknownAddress } }),
    );

    expect(result.signedMessage).toBe('');
    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
  });

  it('returns error -3 when opts.address resolves to a different account than the wrapper UUID', async () => {
    const {
      handler,
      mockAccount,
      renderConfirmationDialog,
      resolveAccountSpy,
    } = setupHandler();
    const otherAccount = generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      mockAccount.address,
      'entropy-source-1',
      1,
    );
    resolveAccountSpy.mockResolvedValueOnce({ account: otherAccount });

    const result = await handler.handle(
      buildRequest(mockAccount.id, {
        opts: { address: otherAccount.address },
      }),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when message is not valid base64', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, { message: 'not valid base64 !!!' }),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('shows the account activation prompt and returns ExternalService when the account is not funded', async () => {
    const { render: renderAccountActivationPrompt } =
      await import('../../ui/confirmation/views/AccountActivationPrompt/render');
    const {
      handler,
      mockAccount,
      renderConfirmationDialog,
      resolveOnChainAccountSpy,
    } = setupHandler();
    resolveOnChainAccountSpy.mockRejectedValueOnce(
      new AccountNotActivatedException(
        mockAccount.address,
        KnownCaip2ChainId.Mainnet,
      ),
    );

    const result = await handler.handle(buildRequest(mockAccount.id));

    expect(jest.mocked(renderAccountActivationPrompt)).toHaveBeenCalledWith(
      mockAccount.address,
    );
    expect(result.error?.code).toBe(Sep43ErrorCode.ExternalService);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });
});
