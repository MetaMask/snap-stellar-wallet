import {
  InvalidParamsError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  ClientRequestMethod,
  MultiChainSendErrorCodes,
  type ConfirmSendJsonRpcRequest,
} from './api';
import { ConfirmSendHandler } from './confirmSend';
import {
  KnownCaip2ChainId,
  type KnownCaip19ClassicAssetId,
  type KnownCaip19Sep41AssetId,
} from '../../api';
import { METAMASK_ORIGIN } from '../../constants';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import type { StellarAssetMetadata } from '../../services/asset-metadata';
import { AssetMetadataService } from '../../services/asset-metadata';
import {
  createMockAssetMetadataService,
  generateMockStellarAssetMetadata,
  USDC_CLASSIC,
  USDC_SEP41,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { AccountNotActivatedException } from '../../services/network';
import {
  OnChainAccount,
  OnChainAccountService,
} from '../../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { TransactionService } from '../../services/transaction';
import {
  buildMockClassicTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
  XdrParseException,
} from '../../services/transaction/exceptions';
import { KeyringTransactionType } from '../../services/transaction/KeyringTransactionBuilder';
import { AssetChangeDirection } from '../../services/transaction-scan';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';
import * as snapUtils from '../../utils/snap';
import { AccountResolver } from '../accountResolver';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('../../ui/confirmation/views/AccountActivationPrompt/render', () => ({
  render: jest.fn().mockResolvedValue(undefined),
}));

const destinationAddress =
  'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';

describe('ConfirmSendHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const assetId = USDC_CLASSIC as KnownCaip19ClassicAssetId;
  const scope = KnownCaip2ChainId.Mainnet;
  const transactionId =
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1';

  function setup() {
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );
    const mockRawAccount = createMockAccountWithBalances(wallet.address, '1', {
      ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      nativeBalance: 10,
      assets: [],
    });
    const onChainAccount = new OnChainAccount(
      mockRawAccount,
      scope,
      horizonSource(mockRawAccount, scope),
    );

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account,
    });
    const resolveOnChainAccountSpy = jest
      .spyOn(OnChainAccountService.prototype, 'resolveOnChainAccount')
      .mockResolvedValue(onChainAccount);
    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const transaction = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: destinationAddress,
            asset: {
              code: 'USDC',
              issuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: wallet.address,
          sequence: onChainAccount.sequenceNumber,
        },
      },
    );

    const { transactionService, transactionRepositorySaveManySpy } =
      createMockTransactionService();
    const createValidatedSendTransaction = jest
      .spyOn(TransactionService.prototype, 'createValidatedSendTransaction')
      .mockResolvedValue(transaction);
    const sendTransaction = jest
      .spyOn(TransactionService.prototype, 'sendTransaction')
      .mockResolvedValue(transactionId);
    const savePendingKeyringTransaction = jest.spyOn(
      TransactionService.prototype,
      'savePendingKeyringTransactionSafe',
    );
    const signTransactionSpy = jest.spyOn(wallet, 'signTransaction');
    const scheduleBackgroundEvent = jest
      .spyOn(TrackTransactionHandler, 'scheduleBackgroundEvent')
      .mockResolvedValue(undefined);

    const { service: assetMetadataService } = createMockAssetMetadataService();
    const assetMetadata = generateMockStellarAssetMetadata()[
      assetId
    ] as StellarAssetMetadata;
    jest
      .spyOn(AssetMetadataService.prototype, 'resolve')
      .mockResolvedValue(assetMetadata);

    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });

    const renderConfirmationDialog = jest
      .spyOn(ConfirmationUXController.prototype, 'renderConfirmationDialog')
      .mockResolvedValue(true);
    const confirmationUIController = new ConfirmationUXController({ logger });

    const handler = new ConfirmSendHandler({
      logger,
      accountResolver,
      assetMetadataService,
      transactionService,
      confirmationUIController,
    });

    const trackTransactionAddedSpy = jest.spyOn(
      snapUtils,
      'trackTransactionAdded',
    );
    const trackTransactionRejectedSpy = jest.spyOn(
      snapUtils,
      'trackTransactionRejected',
    );
    const trackTransactionApprovedSpy = jest.spyOn(
      snapUtils,
      'trackTransactionApproved',
    );

    return {
      handler,
      account,
      onChainAccount,
      wallet,
      assetMetadata,
      transaction,
      createValidatedSendTransaction,
      resolveOnChainAccountSpy,
      renderConfirmationDialog,
      sendTransaction,
      savePendingKeyringTransaction,
      signTransactionSpy,
      scheduleBackgroundEvent,
      transactionRepositorySaveManySpy,
      trackTransactionAddedSpy,
      trackTransactionRejectedSpy,
      trackTransactionApprovedSpy,
    };
  }

  function baseRequest(
    overrides: Partial<
      Pick<
        ConfirmSendJsonRpcRequest['params'],
        'fromAccountId' | 'toAddress' | 'assetId' | 'amount'
      >
    > = {},
  ) {
    return {
      jsonrpc: '2.0' as const,
      id: 1,
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: accountId,
        assetId,
        toAddress: destinationAddress,
        amount: '1',
        ...overrides,
      },
    };
  }

  it('returns invalid when value has more decimal places than the asset supports', async () => {
    const sep41AssetId = USDC_SEP41 as KnownCaip19Sep41AssetId;
    const { handler, createValidatedSendTransaction } = setup();
    const assetMetadata = generateMockStellarAssetMetadata()[
      sep41AssetId
    ] as StellarAssetMetadata;
    jest
      .spyOn(AssetMetadataService.prototype, 'resolve')
      .mockResolvedValue(assetMetadata);

    expect(
      await handler.handle(
        baseRequest({ assetId: sep41AssetId, amount: '1.12345678' }),
      ),
    ).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
    expect(createValidatedSendTransaction).not.toHaveBeenCalled();
  });

  it('returns valid when send validation succeeds', async () => {
    const {
      handler,
      account,
      onChainAccount,
      wallet,
      assetMetadata,
      transaction,
      createValidatedSendTransaction,
      renderConfirmationDialog,
      signTransactionSpy,
      sendTransaction,
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
    } = setup();

    // Capture XDR before signing mutates the transaction.
    const unsignedScanXdr = transaction.getRaw().toXDR();

    const result = await handler.handle(baseRequest());

    expect(result).toStrictEqual({
      valid: true,
      errors: [],
      transactionId,
    });
    expect(createValidatedSendTransaction).toHaveBeenCalledWith({
      onChainAccount,
      scope,
      assetId,
      amount: new BigNumber('10000000'),
      destination: destinationAddress,
    });
    expect(renderConfirmationDialog).toHaveBeenCalledWith({
      scope,
      interfaceKey: ConfirmationInterfaceKey.ConfirmSendTransaction,
      fee: transaction.totalFee.toString(),
      origin: METAMASK_ORIGIN,
      renderContext: {
        account,
        toAddress: destinationAddress,
      },
      renderOptions: {
        loadPrice: true,
        securityScanning: true,
        localSimulation: true,
      },
      securityScanRequest: {
        accountAddress: account.address,
        transaction: unsignedScanXdr,
      },
      initialScan: {
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              value: '1',
              price: null,
              symbol: assetMetadata.symbol,
              name: assetMetadata.name,
              logo: assetMetadata.iconUrl,
            },
          ],
        },
        validation: null,
        error: null,
      },
      transactionValidationRequest: {
        accountId: account.id,
        transaction: unsignedScanXdr,
        request: expect.objectContaining({
          method: ClientRequestMethod.ConfirmSend,
        }),
      },
      tokenPrices: {
        [assetId]: null,
      },
    });
    expect(signTransactionSpy).toHaveBeenCalledWith(transaction);
    expect(sendTransaction).toHaveBeenCalledWith({
      wallet,
      onChainAccount,
      scope,
      transaction,
      pollTransaction: false,
    });
    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Send,
      request: {
        txId: transactionId,
        account,
        scope,
        toAddress: destinationAddress,
        asset: {
          type: assetId,
          unit: 'USDC',
          amount: '1',
          fungible: true,
        },
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      txId: transactionId,
      scope,
      accountIdsOrAddresses: [account.id, destinationAddress],
    });
  });

  it('throws UserRejectedRequestError when confirmation is rejected', async () => {
    const {
      handler,
      renderConfirmationDialog,
      signTransactionSpy,
      sendTransaction,
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
    } = setup();
    renderConfirmationDialog.mockResolvedValue(false);

    await expect(handler.handle(baseRequest())).rejects.toThrow(
      UserRejectedRequestError,
    );

    expect(signTransactionSpy).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(savePendingKeyringTransaction).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('rebuilds the transaction after confirmation before signing', async () => {
    const {
      handler,
      onChainAccount,
      wallet,
      transaction,
      createValidatedSendTransaction,
      signTransactionSpy,
      sendTransaction,
    } = setup();
    const refreshedTransaction = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: destinationAddress,
            asset: {
              code: 'USDC',
              issuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: wallet.address,
          sequence: '2',
        },
      },
    );
    createValidatedSendTransaction
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce(refreshedTransaction);

    await handler.handle(baseRequest());

    expect(createValidatedSendTransaction).toHaveBeenCalledTimes(2);
    expect(signTransactionSpy).toHaveBeenCalledWith(refreshedTransaction);
    expect(sendTransaction).toHaveBeenCalledWith({
      wallet,
      onChainAccount,
      scope,
      transaction: refreshedTransaction,
      pollTransaction: false,
    });
  });

  it('returns invalid when refreshed transaction fee is higher than confirmed fee', async () => {
    const {
      handler,
      wallet,
      transaction,
      createValidatedSendTransaction,
      signTransactionSpy,
      sendTransaction,
    } = setup();
    const higherFeeTransaction = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: destinationAddress,
            asset: {
              code: 'USDC',
              issuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: wallet.address,
          sequence: '2',
        },
        baseFeePerOperation: '300',
      },
    );
    createValidatedSendTransaction
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce(higherFeeTransaction);

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
    expect(signTransactionSpy).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('returns insufficient balance when createValidatedSendTransaction throws InsufficientBalanceException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new InsufficientBalanceException('0', '1'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.InsufficientBalance }],
    });
  });

  it('returns insufficient balance to cover fee when createValidatedSendTransaction throws InsufficientBalanceToCoverFeeException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new InsufficientBalanceToCoverFeeException('0', '1'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [
        { code: MultiChainSendErrorCodes.InsufficientBalanceToCoverFee },
      ],
    });
  });

  it('returns invalid when createValidatedSendTransaction throws TransactionValidationException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new TransactionValidationException('x'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });

  it('returns invalid when createValidatedSendTransaction throws AccountNotActivatedException', async () => {
    const { handler, createValidatedSendTransaction, wallet } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new AccountNotActivatedException(wallet.address, scope),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });

  it('returns invalid when on-chain account is not activated', async () => {
    const { handler, resolveOnChainAccountSpy, wallet } = setup();
    resolveOnChainAccountSpy.mockRejectedValueOnce(
      new AccountNotActivatedException(wallet.address, scope),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });

  it('returns invalid and tracks when createValidatedSendTransaction throws XdrParseException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    const xdrParseError = new XdrParseException(
      'Invalid transfer function arguments',
    );
    createValidatedSendTransaction.mockRejectedValueOnce(xdrParseError);
    const trackErrorSpy = jest
      .spyOn(snapUtils, 'trackError')
      .mockResolvedValue(undefined);

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
    expect(trackErrorSpy).toHaveBeenCalledWith(xdrParseError);
  });

  it('returns invalid for unexpected errors from createValidatedSendTransaction', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    const unexpectedError = new Error('unexpected');
    createValidatedSendTransaction.mockRejectedValueOnce(unexpectedError);
    const trackErrorSpy = jest
      .spyOn(snapUtils, 'trackError')
      .mockResolvedValue(undefined);

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
    expect(trackErrorSpy).toHaveBeenCalledWith(unexpectedError);
  });

  it('does not track expected validation errors from createValidatedSendTransaction', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new TransactionValidationException('x'),
    );
    const trackErrorSpy = jest
      .spyOn(snapUtils, 'trackError')
      .mockResolvedValue(undefined);

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
    expect(trackErrorSpy).not.toHaveBeenCalled();
  });

  it('continues successfully when saving pending transaction fails', async () => {
    const {
      handler,
      transactionRepositorySaveManySpy,
      sendTransaction,
      scheduleBackgroundEvent,
    } = setup();
    transactionRepositorySaveManySpy.mockRejectedValueOnce(
      new Error('failed save'),
    );

    const result = await handler.handle(baseRequest());

    expect(result).toStrictEqual({
      valid: true,
      errors: [],
      transactionId,
    });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('throws InvalidParamsError when amount fails struct validation', async () => {
    const { handler, createValidatedSendTransaction } = setup();

    await expect(
      handler.handle(baseRequest({ amount: '1.00000001' })),
    ).rejects.toThrow(InvalidParamsError);

    expect(createValidatedSendTransaction).not.toHaveBeenCalled();
  });

  it('throws InvalidParamsError when the request fails struct validation', async () => {
    const { handler } = setup();
    const badRequest = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: ClientRequestMethod.OnAmountInput,
      params: {
        accountId,
        assetId,
        amount: '',
      },
    };

    await expect(handler.handle(badRequest)).rejects.toThrow(
      InvalidParamsError,
    );
  });

  describe('tracks transaction events', () => {
    it('tracks transaction added', async () => {
      const { handler, account, trackTransactionAddedSpy } = setup();
      await handler.handle(baseRequest());
      expect(trackTransactionAddedSpy).toHaveBeenCalledWith({
        accountType: account.type,
        chainIdCaip: scope,
        origin: METAMASK_ORIGIN,
      });
    });

    it('tracks transaction rejected', async () => {
      const {
        handler,
        account,
        trackTransactionRejectedSpy,
        renderConfirmationDialog,
      } = setup();
      renderConfirmationDialog.mockResolvedValue(false);

      await expect(handler.handle(baseRequest())).rejects.toThrow(
        UserRejectedRequestError,
      );

      expect(trackTransactionRejectedSpy).toHaveBeenCalledWith({
        accountType: account.type,
        chainIdCaip: scope,
        origin: METAMASK_ORIGIN,
      });
    });

    it('tracks transaction approved', async () => {
      const { handler, account, trackTransactionApprovedSpy } = setup();
      await handler.handle(baseRequest());
      expect(trackTransactionApprovedSpy).toHaveBeenCalledWith({
        accountType: account.type,
        chainIdCaip: scope,
        origin: METAMASK_ORIGIN,
      });
    });
  });
});
