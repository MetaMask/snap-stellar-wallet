/* eslint-disable @typescript-eslint/no-unused-vars, jest/no-disabled-tests */
import { Sep43Method, type Sep43SignMessageRequest } from './api';
import { Sep43SignMessageHandler } from './signMessage';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/account.fixtures';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe.skip('Sep43SignMessageHandler', () => {
  /**
   * Builds a `Sep43SignMessageHandler` with mocked account / wallet resolution
   * and a stubbed `ConfirmationUXController`.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupHandler() {
    const wallet = getTestWallet();
    const [mockAccount] = generateMockStellarKeyringAccounts(
      1,
      'entropy-source-1',
    );
    if (!mockAccount) {
      throw new Error('mockAccount is undefined');
    }

    const { accountService, walletService } = mockOnChainAccountService();

    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: { ...mockAccount, address: wallet.address },
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

    const handler = new Sep43SignMessageHandler({
      logger,
      accountService,
      walletService,
      confirmationUIController,
    });

    return { handler, mockAccount, wallet, renderConfirmationDialog };
  }

  const buildRequest = (
    overrides: Partial<Sep43SignMessageRequest> = {},
  ): Sep43SignMessageRequest => ({
    id: '11111111-1111-4111-8111-111111111111',
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: '00000000-0000-4000-8000-000000000001',
    request: {
      method: Sep43Method.SignMessage,
      params: {
        message: btoa('hello stellar'),
      },
    },
    ...overrides,
  });

  // TODO: implement specs
  it.todo('returns signedMessage and signerAddress on confirm');
  it.todo('returns error -4 when user rejects');
  it.todo('returns error -3 when scope is testnet');
  it.todo(
    'returns error -3 when opts.networkPassphrase is not the mainnet passphrase',
  );
  it.todo('returns error -3 when opts.submit or opts.submitUrl is provided');
  it.todo(
    'returns error -3 when opts.address does not match the wrapper account',
  );
  it.todo('returns error -3 when message is not valid base64');
});
