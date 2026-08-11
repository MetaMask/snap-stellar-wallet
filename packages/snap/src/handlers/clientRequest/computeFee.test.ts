import { FeeType } from '@metamask/keyring-api';
import { Networks } from '@stellar/stellar-sdk';

import { ClientRequestMethod } from './api';
import type { ComputeFeeJsonRpcRequest } from './api';
import { ComputeFeeHandler } from './computeFee';
import { KnownCaip19Slip44IdMap, KnownCaip2ChainId } from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
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
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionService,
} from '../../services/transaction';
import {
  buildMockInvokeHostFunctionTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { logger } from '../../utils/logger';
import { AccountResolver } from '../accountResolver';

jest.mock('../../utils/logger');

describe('ComputeFeeHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup({ subentryCount = 0 }: { subentryCount?: number } = {}) {
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
      subentryCount,
    });
    const onChainAccount = new OnChainAccount(
      mockRawAccount,
      scope,
      horizonSource(mockRawAccount, scope),
    );

    const transaction = buildMockInvokeHostFunctionTransaction('swap', [], {
      baseFeePerOperation: '789',
      networkPassphrase: Networks.PUBLIC,
      source: {
        accountId: wallet.address,
        sequence: onChainAccount.sequenceNumber,
      },
    });
    const xdr = transaction.getRaw().toXDR();

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });
    const resolveAccountSpy = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });
    const resolveOnChainAccountSpy = jest
      .spyOn(OnChainAccountService.prototype, 'resolveOnChainAccount')
      .mockResolvedValue(onChainAccount);
    const resolveWalletSpy = jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const { transactionService } = createMockTransactionService();
    const createValidatedSwapTransaction = jest
      .spyOn(TransactionService.prototype, 'createValidatedSwapTransaction')
      .mockResolvedValue(transaction);
    const sendTransaction = jest
      .spyOn(TransactionService.prototype, 'sendTransaction')
      .mockRejectedValue(new Error('sendTransaction must not be called'));
    const signTransactionSpy = jest.spyOn(wallet, 'signTransaction');

    const handler = new ComputeFeeHandler({
      logger,
      accountResolver,
      transactionService,
    });

    const request: ComputeFeeJsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.ComputeFee,
      params: {
        accountId,
        scope,
        transaction: xdr,
      },
    };

    return {
      handler,
      account,
      onChainAccount,
      wallet,
      transaction,
      xdr,
      request,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveWalletSpy,
      createValidatedSwapTransaction,
      sendTransaction,
      signTransactionSpy,
    };
  }

  it('returns the native display base fee for a validated swap transaction', async () => {
    const {
      handler,
      account,
      onChainAccount,
      xdr,
      request,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveWalletSpy,
      createValidatedSwapTransaction,
      sendTransaction,
      signTransactionSpy,
    } = setup();

    const result = await handler.handle(request);

    expect(result).toStrictEqual([
      {
        type: FeeType.Base,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: KnownCaip19Slip44IdMap[scope],
          amount: '0.0000789',
          fungible: true,
        },
      },
    ]);
    expect(resolveAccountSpy).toHaveBeenCalledWith({ accountId });
    expect(resolveOnChainAccountSpy).toHaveBeenCalledWith(
      account.address,
      scope,
    );
    expect(resolveWalletSpy).toHaveBeenCalledWith(account);
    expect(createValidatedSwapTransaction).toHaveBeenCalledWith({
      xdr,
      scope,
      onChainAccount,
    });
    expect(signTransactionSpy).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('throws when the swap transaction cannot be validated', async () => {
    const { handler, request, createValidatedSwapTransaction } = setup();
    createValidatedSwapTransaction.mockRejectedValueOnce(
      new Error('Invalid swap transaction'),
    );

    await expect(handler.handle(request)).rejects.toThrow(
      'Invalid swap transaction',
    );
  });

  // The mock account has no subentries, so its minimum reserve is the 2 base
  // reserves (1 XLM) that get added to the required amount below.
  it('returns the required native fee plus the minimum reserve when balance is insufficient to cover fees', async () => {
    const { handler, request, createValidatedSwapTransaction } = setup();
    createValidatedSwapTransaction.mockRejectedValueOnce(
      new InsufficientBalanceToCoverFeeException('100', '12500000'),
    );

    const result = await handler.handle(request);

    expect(result).toStrictEqual([
      {
        type: FeeType.Base,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: KnownCaip19Slip44IdMap[scope],
          amount: '2.25',
          fungible: true,
        },
      },
    ]);
  });

  it('returns the required native amount plus the minimum reserve when native balance is insufficient for the swap', async () => {
    const { handler, request, createValidatedSwapTransaction } = setup();
    createValidatedSwapTransaction.mockRejectedValueOnce(
      new InsufficientBalanceException(
        '100',
        '50000000',
        KnownCaip19Slip44IdMap[scope],
      ),
    );

    const result = await handler.handle(request);

    expect(result).toStrictEqual([
      {
        type: FeeType.Base,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: KnownCaip19Slip44IdMap[scope],
          amount: '6',
          fungible: true,
        },
      },
    ]);
  });

  it('scales the reported reserve with the account subentry count', async () => {
    // 5 trustlines -> (2 + 5) base reserves -> 3.5 XLM on top of 0.99125 XLM.
    const { handler, request, createValidatedSwapTransaction } = setup({
      subentryCount: 5,
    });
    createValidatedSwapTransaction.mockRejectedValueOnce(
      new InsufficientBalanceException(
        '5095615',
        '9912500',
        KnownCaip19Slip44IdMap[scope],
      ),
    );

    const result = await handler.handle(request);

    expect(result).toStrictEqual([
      {
        type: FeeType.Base,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: KnownCaip19Slip44IdMap[scope],
          amount: '4.49125',
          fungible: true,
        },
      },
    ]);
  });

  it('rethrows when balance is insufficient for a non-native asset', async () => {
    const { handler, request, createValidatedSwapTransaction } = setup();
    const nonSlip44AssetId =
      'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    const error = new InsufficientBalanceException(
      '100',
      '50000000',
      nonSlip44AssetId,
    );
    createValidatedSwapTransaction.mockRejectedValueOnce(error);

    await expect(handler.handle(request)).rejects.toBe(error);
  });

  it('rethrows when InsufficientBalanceException has no assetId', async () => {
    const { handler, request, createValidatedSwapTransaction } = setup();
    const error = new InsufficientBalanceException('100', '50000000');
    createValidatedSwapTransaction.mockRejectedValueOnce(error);

    await expect(handler.handle(request)).rejects.toBe(error);
  });
});
