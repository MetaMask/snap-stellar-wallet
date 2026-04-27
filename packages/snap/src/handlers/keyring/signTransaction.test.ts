import { Keypair, Networks } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignTransactionRequest } from './api';
import { Sep43ErrorCode } from './exceptions';
import { SignTransactionHandler } from './signTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import {
  generateStellarKeyringAccount,
  mockAccountService,
} from '../../services/account/__mocks__/account.fixtures';
import { SimulationException } from '../../services/network/exceptions';
import type { Transaction } from '../../services/transaction';
import { TransactionService } from '../../services/transaction';
import {
  buildMockClassicTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('SignTransactionHandler', () => {
  /**
   * Builds a {@link SignTransactionHandler} with mocked services + account/wallet
   * resolution, plus a stubbed `ConfirmationUXController`.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupHandler() {
    const wallet = getTestWallet();
    const mockAccount = generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      wallet.address,
      'entropy-source-1',
      0,
    );

    const { transactionBuilder, transactionService } =
      createMockTransactionService();
    const { accountService, walletService } = mockAccountService();

    const resolveAccountSpy = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account: mockAccount });

    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    // Default: pass-through fee (no Soroban simulation needed for classic tx).
    jest
      .spyOn(TransactionService.prototype, 'computingFee')
      .mockImplementation(async (tx) => tx);

    const renderConfirmationDialog = jest.fn();
    const confirmationUIController = {
      renderConfirmationDialog,
    } as Pick<
      ConfirmationUXController,
      'renderConfirmationDialog'
    > as unknown as ConfirmationUXController;

    const handler = new SignTransactionHandler({
      logger,
      accountService,
      walletService,
      transactionBuilder,
      transactionService,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      transactionService,
      renderConfirmationDialog,
      resolveAccountSpy,
    };
  }

  /**
   * Builds a mainnet payment transaction whose source is the wallet so it
   * passes `assertAccountInvolvesTransaction`.
   *
   * @param walletAddress - Wallet's Stellar public key (`G…`).
   * @returns Mock transaction built with `Networks.PUBLIC`.
   */
  function buildMainnetPaymentFromWallet(walletAddress: string): Transaction {
    return buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: Keypair.random().publicKey(),
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: { accountId: walletAddress, sequence: '1' },
      },
    );
  }

  const buildRequest = (
    accountId: string,
    xdr: string,
    overrides: Partial<SignTransactionRequest['request']['params']> = {},
  ): SignTransactionRequest => ({
    id: '22222222-2222-4222-8222-222222222222',
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: accountId,
    request: {
      method: MultichainMethod.SignTransaction,
      params: { xdr, ...overrides },
    },
  });

  it('returns signedTxXdr and signerAddress on confirm', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      renderConfirmationDialog,
    } = setupHandler();

    const transaction = buildMainnetPaymentFromWallet(wallet.address);
    const xdr = transaction.getRaw().toXDR();
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    const signSpy = jest.spyOn(wallet, 'signTransaction');
    renderConfirmationDialog.mockResolvedValue(true);

    const result = await handler.handle(buildRequest(mockAccount.id, xdr));

    expect(signSpy).toHaveBeenCalledWith(transaction);
    expect(result.signedTxXdr).toStrictEqual(transaction.getRaw().toXDR());
    expect(result.signerAddress).toBe(wallet.address);
    expect(result.error).toBeUndefined();
  });

  it('returns error -4 when user rejects', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      renderConfirmationDialog,
    } = setupHandler();

    const transaction = buildMainnetPaymentFromWallet(wallet.address);
    const xdr = transaction.getRaw().toXDR();
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    const signSpy = jest.spyOn(wallet, 'signTransaction');
    renderConfirmationDialog.mockResolvedValue(false);

    const result = await handler.handle(buildRequest(mockAccount.id, xdr));

    expect(signSpy).not.toHaveBeenCalled();
    expect(result.signedTxXdr).toBe('');
    expect(result.signerAddress).toBe(wallet.address);
    expect(result.error?.code).toBe(Sep43ErrorCode.UserRejected);
  });

  it('returns error -3 when XDR is invalid', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, 'not-an-xdr'),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when the transaction scope does not match the request scope', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      renderConfirmationDialog,
    } = setupHandler();

    // Build a TESTNET transaction but request signing on MAINNET scope.
    const testnetTx = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: Keypair.random().publicKey(),
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.TESTNET,
        source: { accountId: wallet.address, sequence: '1' },
      },
    );
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(testnetTx);

    const result = await handler.handle(
      buildRequest(mockAccount.id, testnetTx.getRaw().toXDR()),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when the wallet does not participate in the transaction', async () => {
    const {
      handler,
      mockAccount,
      transactionBuilder,
      renderConfirmationDialog,
    } = setupHandler();

    const strangerTx = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: Keypair.random().publicKey(),
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: Keypair.random().publicKey(),
          sequence: '1',
        },
      },
    );
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(strangerTx);

    const result = await handler.handle(
      buildRequest(mockAccount.id, strangerTx.getRaw().toXDR()),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when scope is testnet', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle({
      ...buildRequest(mockAccount.id, 'AAAA'),
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.networkPassphrase is not the mainnet passphrase', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, 'AAAA', {
        opts: { networkPassphrase: Networks.TESTNET },
      }),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it.each([
    ['opts.submit', { submit: true }],
    ['opts.submitUrl', { submitUrl: 'https://horizon.stellar.org' }],
  ])('returns error -3 when %s is provided', async (_label, forbiddenOpts) => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const base = buildRequest(mockAccount.id, 'AAAA');
    (base.request.params as unknown as { opts: Record<string, unknown> }).opts =
      forbiddenOpts;

    const result = await handler.handle(base);

    expect(result.error?.code).toBe(Sep43ErrorCode.InvalidRequest);
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -2 when fee simulation fails', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      transactionService,
      renderConfirmationDialog,
    } = setupHandler();

    const transaction = buildMainnetPaymentFromWallet(wallet.address);
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    jest
      .spyOn(transactionService, 'computingFee')
      .mockRejectedValueOnce(new SimulationException('contract not found'));

    const result = await handler.handle(
      buildRequest(mockAccount.id, transaction.getRaw().toXDR()),
    );

    expect(result.error?.code).toBe(Sep43ErrorCode.ExternalService);
    expect(result.error?.ext?.[0]).toContain('Failed to simulate transaction');
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });
});
