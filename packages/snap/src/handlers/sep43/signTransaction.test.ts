/* eslint-disable @typescript-eslint/no-unused-vars, jest/no-disabled-tests */
import { Sep43Method, type Sep43SignTransactionRequest } from './api';
import { Sep43SignTransactionHandler } from './signTransaction';
import { KnownCaip2ChainId } from '../../api';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe.skip('Sep43SignTransactionHandler', () => {
  /**
   * Builds a `Sep43SignTransactionHandler` with mocked services.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupHandler() {
    const { transactionBuilder, transactionService } =
      createMockTransactionService();
    const { accountService, walletService } = mockOnChainAccountService();

    return {
      transactionBuilder,
      transactionService,
      accountService,
      walletService,
      logger,
    };
  }

  const buildRequest = (
    overrides: Partial<Sep43SignTransactionRequest> = {},
  ): Sep43SignTransactionRequest => ({
    id: '22222222-2222-4222-8222-222222222222',
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: '00000000-0000-4000-8000-000000000001',
    request: {
      method: Sep43Method.SignTransaction,
      params: {
        // Replace with a valid mainnet XDR built via buildMockClassicTransaction
        // before implementing specs.
        xdr: 'placeholder',
      },
    },
    ...overrides,
  });

  // TODO: implement specs
  it.todo('returns signedTxXdr and signerAddress on confirm');
  it.todo('returns error -4 when user rejects');
  it.todo('returns error -3 when XDR is invalid');
  it.todo(
    'returns error -3 when XDR network does not match scope (testnet XDR on mainnet scope)',
  );
  it.todo(
    'returns error -3 when wallet account does not participate in the transaction',
  );
  it.todo('returns error -3 when scope is testnet');
  it.todo(
    'returns error -3 when opts.networkPassphrase is not the mainnet passphrase',
  );
  it.todo('returns error -3 when opts.submit or opts.submitUrl is provided');
  it.todo(
    'returns error -3 when opts.address does not match the wrapper account',
  );
  it.todo('returns error -2 when fee simulation fails (Soroban)');
});
