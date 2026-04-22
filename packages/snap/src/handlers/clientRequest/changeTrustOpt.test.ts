import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';

import {
  ClientRequestMethod,
  ChangeTrustOptAction,
  type ChangeTrustOptJsonRpcRequest,
} from './api';
import { ChangeTrustOptHandler } from './changeTrustOpt';
import { KnownCaip2ChainId, type KnownCaip19ClassicAssetId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import type { StellarAssetMetadata } from '../../services/asset-metadata';
import { AssetMetadataService } from '../../services/asset-metadata';
import {
  createMockAssetMetadataService,
  generateMockStellarAssetMetadata,
  USDC_CLASSIC,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { NetworkService } from '../../services/network';
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
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import { TrustlineNotFoundException } from '../../services/transaction/exceptions';
import { KeyringTransactionType } from '../../services/transaction/KeyringTransactionBuilder';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import { ConfirmationUXController } from '../../ui/confirmation/controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('ChangeTrustOptHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;
  const assetId = USDC_CLASSIC as KnownCaip19ClassicAssetId;
  const trustlineAsset = {
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    balance: 0,
  };

  const addRequest: ChangeTrustOptJsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: ClientRequestMethod.ChangeTrustOpt,
    params: {
      accountId,
      scope,
      assetId,
      action: ChangeTrustOptAction.Add,
      limit: '1.5',
    },
  };
  const deleteRequest: ChangeTrustOptJsonRpcRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: ClientRequestMethod.ChangeTrustOpt,
    params: {
      accountId,
      scope,
      assetId,
      action: ChangeTrustOptAction.Delete,
      limit: '0',
    },
  };

  function setup({ withTrustline = false }: { withTrustline?: boolean } = {}) {
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
      assets: withTrustline ? [trustlineAsset] : [],
    });
    const onChainAccount = new OnChainAccount(
      mockRawAccount,
      scope,
      horizonSource(mockRawAccount, scope),
    );

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    const resolveAccountSpy = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });
    const resolveOnChainAccountSpy = jest
      .spyOn(OnChainAccountService.prototype, 'resolveOnChainAccount')
      .mockResolvedValue(onChainAccount);
    const resolveWalletSpy = jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const signTransactionSpy = jest.spyOn(wallet, 'signTransaction');

    const { transactionService, transactionRepositorySaveSpy } =
      createMockTransactionService();
    const getBaseFeeSpy = jest
      .spyOn(NetworkService.prototype, 'getBaseFee')
      .mockResolvedValue(new BigNumber(100));
    const networkSendSpy = jest
      .spyOn(NetworkService.prototype, 'send')
      .mockResolvedValue('dGVzdC10eC1pZA==');
    const createValidatedChangeTrustTransaction = jest.spyOn(
      TransactionService.prototype,
      'createValidatedChangeTrustTransaction',
    );
    const sendTransaction = jest.spyOn(
      TransactionService.prototype,
      'sendTransaction',
    );
    const savePendingKeyringTransaction = jest.spyOn(
      TransactionService.prototype,
      'savePendingKeyringTransaction',
    );

    const { service: assetMetadataService } = createMockAssetMetadataService();
    const assetMetadata = generateMockStellarAssetMetadata()[assetId] as {
      symbol: string;
      assetId: string;
    } as StellarAssetMetadata;
    const resolve = jest
      .spyOn(AssetMetadataService.prototype, 'resolve')
      .mockResolvedValue(assetMetadata);

    const renderConfirmationDialog = jest
      .spyOn(ConfirmationUXController.prototype, 'renderConfirmationDialog')
      .mockResolvedValue(true);
    const confirmationUIController = new ConfirmationUXController({ logger });

    const handler = new ChangeTrustOptHandler({
      logger,
      accountService,
      onChainAccountService,
      walletService,
      transactionService,
      assetMetadataService,
      confirmationUIController,
    });

    return {
      handler,
      account,
      onChainAccount,
      wallet,
      assetMetadata,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveWalletSpy,
      getBaseFeeSpy,
      networkSendSpy,
      createValidatedChangeTrustTransaction,
      sendTransaction,
      savePendingKeyringTransaction,
      transactionRepositorySaveSpy,
      resolve,
      renderConfirmationDialog,
      signTransactionSpy,
    };
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('handles changeTrust opt-in and saves pending keyring transaction', async () => {
    const {
      handler,
      account,
      onChainAccount,
      wallet,
      assetMetadata,
      createValidatedChangeTrustTransaction,
      sendTransaction,
      savePendingKeyringTransaction,
      resolve,
      renderConfirmationDialog,
      signTransactionSpy,
    } = setup();

    const result = await handler.handle(addRequest);

    expect(result).toStrictEqual({
      status: true,
      transactionId: 'dGVzdC10eC1pZA==',
    });

    expect(resolve).toHaveBeenCalledWith(assetId);
    expect(createValidatedChangeTrustTransaction).toHaveBeenCalledWith({
      onChainAccount,
      assetId,
      scope,
      limit: '1.5',
    });
    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        interfaceKey: ConfirmationInterfaceKey.ChangeTrustlineOptIn,
        fee: '100',
        renderContext: {
          account,
          assetMetadata,
        },
      }),
    );
    const signedTransaction = signTransactionSpy.mock.calls[0]?.[0];
    expect(signedTransaction).toBeDefined();
    expect(sendTransaction).toHaveBeenCalledWith({
      wallet,
      onChainAccount,
      scope,
      transaction: signedTransaction,
    });
    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.ChangeTrustOptIn,
      request: {
        txId: 'dGVzdC10eC1pZA==',
        account,
        scope,
        asset: {
          type: assetId,
          symbol: 'USDC',
        },
      },
    });
  });

  it('returns success early for opt-in when trustline already exists', async () => {
    const {
      handler,
      createValidatedChangeTrustTransaction,
      resolve,
      renderConfirmationDialog,
      sendTransaction,
      savePendingKeyringTransaction,
      signTransactionSpy,
    } = setup({ withTrustline: true });

    const result = await handler.handle(addRequest);

    expect(result).toStrictEqual({ status: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(createValidatedChangeTrustTransaction).not.toHaveBeenCalled();
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
    expect(signTransactionSpy).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(savePendingKeyringTransaction).not.toHaveBeenCalled();
  });

  it('throws TrustlineNotFoundException for opt-out when trustline does not exist', async () => {
    const {
      handler,
      resolve,
      createValidatedChangeTrustTransaction,
      renderConfirmationDialog,
      sendTransaction,
      savePendingKeyringTransaction,
    } = setup();

    await expect(handler.handle(deleteRequest)).rejects.toThrow(
      TrustlineNotFoundException,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(createValidatedChangeTrustTransaction).not.toHaveBeenCalled();
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(savePendingKeyringTransaction).not.toHaveBeenCalled();
  });

  it('handles changeTrust opt-out and enforces delete limit to 0', async () => {
    const {
      handler,
      account,
      onChainAccount,
      assetMetadata,
      createValidatedChangeTrustTransaction,
      sendTransaction,
      savePendingKeyringTransaction,
      renderConfirmationDialog,
      networkSendSpy,
    } = setup({ withTrustline: true });

    const result = await handler.handle(deleteRequest);

    expect(result).toStrictEqual({
      status: true,
      transactionId: 'dGVzdC10eC1pZA==',
    });
    expect(createValidatedChangeTrustTransaction).toHaveBeenCalledWith({
      onChainAccount,
      assetId,
      scope,
      limit: '0',
    });
    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        interfaceKey: ConfirmationInterfaceKey.ChangeTrustlineOptOut,
      }),
    );
    expect(sendTransaction).toHaveBeenCalled();
    expect(networkSendSpy).toHaveBeenCalledTimes(1);
    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.ChangeTrustOptOut,
      request: {
        txId: 'dGVzdC10eC1pZA==',
        account,
        scope,
        asset: {
          type: assetId,
          symbol: assetMetadata.symbol,
        },
      },
    });
  });

  it('throws UserRejectedRequestError when confirmation is rejected', async () => {
    const {
      handler,
      renderConfirmationDialog,
      signTransactionSpy,
      sendTransaction,
      savePendingKeyringTransaction,
      networkSendSpy,
    } = setup();
    renderConfirmationDialog.mockResolvedValue(false);

    await expect(handler.handle(addRequest)).rejects.toThrow(
      UserRejectedRequestError,
    );

    expect(signTransactionSpy).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(networkSendSpy).not.toHaveBeenCalled();
    expect(savePendingKeyringTransaction).not.toHaveBeenCalled();
  });

  it('continues successfully when saving pending transaction fails', async () => {
    const { handler, transactionRepositorySaveSpy, sendTransaction } = setup();
    transactionRepositorySaveSpy.mockRejectedValueOnce(
      new Error('failed save'),
    );

    const result = await handler.handle(addRequest);

    expect(result).toStrictEqual({
      status: true,
      transactionId: 'dGVzdC10eC1pZA==',
    });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});
