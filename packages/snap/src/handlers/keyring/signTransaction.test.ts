import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { Keypair, Networks } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignTransactionRequest } from './api';
import { SignTransactionHandler } from './signTransaction';
import { KnownCaip2ChainId } from '../../api';
import type { StellarKeyringAccount } from '../../services/account';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { TransactionBuilder } from '../../services/transaction';
import {
  TransactionService,
  OperationMapper,
} from '../../services/transaction';
import {
  buildMockClassicTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { WalletService, Wallet } from '../../services/wallet';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('SignTransactionHandler', () => {
  const keyringRequestId = '22222222-2222-4222-8222-222222222222';

  /**
   * Builds a {@link SignTransactionHandler} with mocked account/wallet resolution
   * and a stubbed `ConfirmationUXController`.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupSignTransactionHandler(): {
    handler: SignTransactionHandler;
    mockAccount: StellarKeyringAccount;
    wallet: Wallet;
    walletKeypair: Keypair;
    renderConfirmationDialog: jest.Mock;
    transactionBuilder: TransactionBuilder;
    transactionService: TransactionService;
  } {
    const walletKeypair = Keypair.random();
    const wallet = new Wallet(walletKeypair);

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

    const { transactionBuilder, transactionService } =
      createMockTransactionService();

    // Default: pass-through fee (no Soroban simulation needed for classic tx).
    jest
      .spyOn(TransactionService.prototype, 'computingFee')
      .mockImplementation(async (transaction) => transaction);

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
      onChainAccountService,
      walletService,
      transactionBuilder,
      transactionService,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      walletKeypair,
      renderConfirmationDialog,
      transactionBuilder,
      transactionService,
    };
  }

  /**
   * Builds a single-payment transaction whose source is the wallet account so it
   * passes {@link assertAccountInvolvesTransaction}.
   *
   * @param walletAddress - The wallet's Stellar public key (`G…`).
   * @returns The mock transaction.
   */
  function buildPaymentTxFromWallet(walletAddress: string) {
    return buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: Keypair.random().publicKey(),
            asset: 'native',
            amount: '10',
          },
        },
      ],
      {
        networkPassphrase: Networks.TESTNET,
        source: { accountId: walletAddress, sequence: '1' },
      },
    );
  }

  const buildRequest = (transactionXdr: string): SignTransactionRequest => ({
    id: keyringRequestId,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Testnet,
    account: '00000000-0000-4000-8000-000000000001',
    request: {
      method: MultichainMethod.SignTransaction,
      params: { transaction: transactionXdr },
    },
  });

  it('renders confirmation with fee, native price slot, and signs when accepted', async () => {
    const {
      handler,
      mockAccount,
      wallet,
      renderConfirmationDialog,
      transactionBuilder,
    } = setupSignTransactionHandler();

    const transaction = buildPaymentTxFromWallet(wallet.address);
    const xdr = transaction.getRaw().toXDR();

    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    const signSpy = jest.spyOn(wallet, 'signTransaction');

    renderConfirmationDialog.mockResolvedValue(true);

    const request = buildRequest(xdr);
    const result = await handler.handle(request);

    expect(renderConfirmationDialog).toHaveBeenCalledTimes(1);
    const callArgs = renderConfirmationDialog.mock.calls[0]?.[0];
    expect(callArgs).toMatchObject({
      scope: KnownCaip2ChainId.Testnet,
      origin: 'https://example.com',
      interfaceKey: ConfirmationInterfaceKey.SignTransaction,
      fee: transaction.totalFee.toFixed(0),
      renderOptions: { loadPrice: true },
    });
    expect(callArgs.renderContext.account).toStrictEqual(mockAccount);
    expect(callArgs.renderContext.readableTransaction).toStrictEqual(
      new OperationMapper().mapTransaction(transaction),
    );

    // Hard-coded so a parser regression actually fails the test.
    expect(callArgs.tokenPrices).toStrictEqual({
      'stellar:testnet/slip44:148': null,
    });

    expect(signSpy).toHaveBeenCalledWith(transaction);
    expect(typeof result).toBe('object');
    expect((result as { signature: string }).signature).toStrictEqual(
      transaction.getRaw().toXDR(),
    );
  });

  it('seeds tokenPrices with classic-asset CAIP-19 ids alongside the native fee asset', async () => {
    const { handler, wallet, renderConfirmationDialog, transactionBuilder } =
      setupSignTransactionHandler();

    const issuer = Keypair.random().publicKey();
    const transaction = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: Keypair.random().publicKey(),
            asset: { code: 'USDC', issuer },
            amount: '5',
          },
        },
        {
          type: 'changeTrust',
          params: {
            asset: { code: 'USDC', issuer },
            limit: '1000',
          },
        },
      ],
      {
        networkPassphrase: Networks.TESTNET,
        source: { accountId: wallet.address, sequence: '1' },
      },
    );
    const xdr = transaction.getRaw().toXDR();
    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    renderConfirmationDialog.mockResolvedValue(true);

    await handler.handle(buildRequest(xdr));

    const callArgs = renderConfirmationDialog.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    const { tokenPrices } = callArgs;

    // Classic asset CAIP-19 keyed for cron price refresh.
    expect(tokenPrices).toHaveProperty(
      `stellar:testnet/asset:USDC-${issuer}`,
      null,
    );
    // Same USDC trustline op should not duplicate the entry.
    expect(Object.keys(tokenPrices)).toHaveLength(1);
  });

  it('throws UserRejectedRequestError when confirmation rejects', async () => {
    const { handler, wallet, renderConfirmationDialog, transactionBuilder } =
      setupSignTransactionHandler();

    const transaction = buildPaymentTxFromWallet(wallet.address);
    const xdr = transaction.getRaw().toXDR();

    jest.spyOn(transactionBuilder, 'deserialize').mockReturnValue(transaction);
    const signSpy = jest.spyOn(wallet, 'signTransaction');

    renderConfirmationDialog.mockResolvedValue(false);

    await expect(handler.handle(buildRequest(xdr))).rejects.toThrow(
      UserRejectedRequestError,
    );
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid requests before resolving the account', async () => {
    const { handler, renderConfirmationDialog } = setupSignTransactionHandler();

    const resolveAccountSpy = jest.spyOn(
      AccountService.prototype,
      'resolveAccount',
    );

    await expect(
      handler.handle({
        ...buildRequest(''),
        request: {
          method: MultichainMethod.SignTransaction,
          params: { transaction: '' },
        },
      }),
    ).rejects.toThrow(/transaction/u);

    expect(resolveAccountSpy).not.toHaveBeenCalled();
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });
});
