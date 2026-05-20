import { Keypair, Networks } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignTransactionRequest } from './api';
import { Sep43ErrorCode } from './exceptions';
import { SignTransactionHandler } from './signTransaction';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { Transaction } from '../../services/transaction';
import {
  buildMockClassicTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';
import { AccountResolver } from '../accountResolver';

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

    const { transactionBuilder } = createMockTransactionService();
    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });

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

    const handler = new SignTransactionHandler({
      logger,
      accountResolver,
      transactionBuilder,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      renderConfirmationDialog,
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
    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        renderOptions: {
          loadPrice: true,
          scanTxn: true,
        },
        securityScanRequest: {
          accountAddress: mockAccount.address,
          transaction: expect.any(String),
        },
      }),
    );
    expect(result).toStrictEqual({
      signedTxXdr: transaction.getRaw().toXDR(),
      signerAddress: wallet.address,
    });
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
    expect(result).toMatchObject({
      signedTxXdr: '',
      signerAddress: wallet.address,
      error: { code: Sep43ErrorCode.UserRejected },
    });
  });

  it('returns error -3 when XDR is invalid', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, 'not-an-xdr'),
    );

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
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

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
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

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when scope is testnet', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle({
      ...buildRequest(mockAccount.id, 'AAAA'),
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.networkPassphrase is not the mainnet passphrase', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, 'AAAA', {
        opts: { networkPassphrase: Networks.TESTNET },
      }),
    );

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
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

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('signs the exact envelope provided by the dapp (no fee/footprint mutation)', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      transactionBuilder,
      renderConfirmationDialog,
    } = setupHandler();

    const transaction = buildMainnetPaymentFromWallet(wallet.address);
    const inputXdr = transaction.getRaw().toXDR();
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    const signSpy = jest.spyOn(wallet, 'signTransaction');
    renderConfirmationDialog.mockResolvedValue(true);

    const result = await handler.handle(buildRequest(mockAccount.id, inputXdr));

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(signSpy).toHaveBeenCalledWith(transaction);
    // The scanned XDR is the dapp's original envelope, not a wallet-mutated one.
    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        securityScanRequest: expect.objectContaining({
          transaction: inputXdr,
        }),
      }),
    );
    expect(result).toMatchObject({
      signedTxXdr: expect.any(String),
      signerAddress: wallet.address,
    });
  });
});
