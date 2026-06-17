import { FeeType, TransactionType } from '@metamask/keyring-api';
import { Networks } from '@stellar/stellar-sdk';

import {
  ClientRequestMethod,
  type SignAndSendTransactionJsonRpcRequest,
} from './api';
import { SignAndSendTransactionHandler } from './signAndSendTransaction';
import { KnownCaip19Slip44IdMap, KnownCaip2ChainId } from '../../api';
import { METAMASK_ORIGIN } from '../../constants';
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
import { TransactionService } from '../../services/transaction';
import {
  buildMockClassicTransaction,
  buildMockInvokeHostFunctionTransaction,
  createMockTransactionService,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { KeyringTransactionType } from '../../services/transaction/KeyringTransactionBuilder';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { toCaip19ClassicAssetId, toDisplayBalance } from '../../utils';
import { logger } from '../../utils/logger';
import * as snapUtils from '../../utils/snap';
import { AccountResolver } from '../accountResolver';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
}));
jest.mock('../../utils/logger');

describe('SignAndSendTransactionHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;
  const transactionId =
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1';

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

    const transaction = buildMockInvokeHostFunctionTransaction('swap', [], {
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
      .mockResolvedValue(transactionId);
    const savePendingKeyringTransaction = jest.spyOn(
      TransactionService.prototype,
      'savePendingKeyringTransaction',
    );
    const scheduleBackgroundEvent = jest
      .spyOn(TrackTransactionHandler, 'scheduleBackgroundEvent')
      .mockResolvedValue(undefined);
    const signTransactionSpy = jest.spyOn(wallet, 'signTransaction');

    const handler = new SignAndSendTransactionHandler({
      logger,
      accountResolver,
      transactionService,
    });

    const trackTransactionSubmittedSpy = jest.spyOn(
      snapUtils,
      'trackTransactionSubmitted',
    );

    const request: SignAndSendTransactionJsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.SignAndSendTransaction,
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
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
      signTransactionSpy,
      trackTransactionSubmittedSpy,
    };
  }

  it('signs, sends, and schedules tracking for a swap transaction', async () => {
    const {
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
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
      signTransactionSpy,
    } = setup();

    const result = await handler.handle(request);

    expect(result).toStrictEqual({ transactionId });
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
    expect(signTransactionSpy).toHaveBeenCalledWith(transaction);
    expect(sendTransaction).toHaveBeenCalledWith({
      wallet,
      onChainAccount,
      scope,
      transaction,
      pollTransaction: false,
    });
    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        asset: {
          type: 'stellar:pubnet/slip44:148',
          symbol: 'XLM',
        },
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      scope,
      txId: transactionId,
      accountIdsOrAddresses: [account.id],
    });
  });

  it('saves pending activity when options.visible is false', async () => {
    const {
      handler,
      account,
      request,
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
    } = setup();

    await handler.handle({
      ...request,
      params: {
        ...request.params,
        options: {
          visible: false,
        },
      },
    });

    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        asset: {
          type: 'stellar:pubnet/slip44:148',
          symbol: 'XLM',
        },
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      scope,
      txId: transactionId,
      accountIdsOrAddresses: [account.id],
    });
  });

  it('saves detailed pending activity for a classic path payment swap', async () => {
    const {
      handler,
      account,
      wallet,
      onChainAccount,
      request,
      createValidatedSwapTransaction,
      savePendingKeyringTransaction,
    } = setup();
    const destinationAsset = {
      code: 'USDC',
      issuer: getTestWallet().address,
    } as const;
    const destinationAssetId = toCaip19ClassicAssetId(
      scope,
      destinationAsset.code,
      destinationAsset.issuer,
    );
    const feeDestination = getTestWallet({
      seed: new Uint8Array(32).fill(1),
    }).address;
    const transaction = buildMockClassicTransaction(
      [
        {
          type: 'pathPaymentStrictSend',
          params: {
            sendAsset: 'native',
            sendAmount: '10',
            destination: wallet.address,
            destAsset: destinationAsset,
            destMin: '5',
          },
        },
        {
          type: 'payment',
          params: {
            destination: feeDestination,
            asset: 'native',
            amount: '0.1',
          },
        },
      ],
      {
        baseFeePerOperation: '100',
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: wallet.address,
          sequence: onChainAccount.sequenceNumber,
        },
      },
    );
    const xdr = transaction.getRaw().toXDR();
    createValidatedSwapTransaction.mockResolvedValueOnce(transaction);

    await handler.handle({
      ...request,
      params: {
        ...request.params,
        transaction: xdr,
      },
    });

    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        transactionType: TransactionType.Swap,
        from: [
          {
            address: wallet.address,
            asset: {
              unit: 'XLM',
              type: KnownCaip19Slip44IdMap[scope],
              amount: '10',
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: wallet.address,
            asset: {
              unit: 'USDC',
              type: destinationAssetId,
              amount: '5',
              fungible: true,
            },
          },
        ],
        fees: [
          {
            type: FeeType.Base,
            asset: {
              unit: 'XLM',
              type: KnownCaip19Slip44IdMap[scope],
              amount: toDisplayBalance(transaction.totalFee),
              fungible: true,
            },
          },
        ],
      },
    });
  });

  it('marks an undecoded cross-chain transaction as a bridge send', async () => {
    const {
      handler,
      account,
      request,
      savePendingKeyringTransaction,
      scheduleBackgroundEvent,
    } = setup();

    await handler.handle({
      ...request,
      params: {
        ...request.params,
        options: {
          sourceChainId: scope,
          destChainId: 'eip155:1',
        },
      },
    });

    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        transactionType: TransactionType.BridgeSend,
        asset: {
          type: 'stellar:pubnet/slip44:148',
          symbol: 'XLM',
        },
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      scope,
      txId: transactionId,
      accountIdsOrAddresses: [account.id],
    });
  });

  it('keeps a same-chain swap when source and destination chains match', async () => {
    const { handler, account, request, savePendingKeyringTransaction } =
      setup();

    await handler.handle({
      ...request,
      params: {
        ...request.params,
        options: {
          sourceChainId: scope,
          destChainId: scope,
        },
      },
    });

    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        asset: {
          type: 'stellar:pubnet/slip44:148',
          symbol: 'XLM',
        },
      },
    });
  });

  it('marks a classic path payment as a bridge send when cross-chain', async () => {
    const {
      handler,
      account,
      wallet,
      onChainAccount,
      request,
      createValidatedSwapTransaction,
      savePendingKeyringTransaction,
    } = setup();
    const destinationAsset = {
      code: 'USDC',
      issuer: getTestWallet().address,
    } as const;
    const destinationAssetId = toCaip19ClassicAssetId(
      scope,
      destinationAsset.code,
      destinationAsset.issuer,
    );
    const transaction = buildMockClassicTransaction(
      [
        {
          type: 'pathPaymentStrictSend',
          params: {
            sendAsset: 'native',
            sendAmount: '10',
            destination: wallet.address,
            destAsset: destinationAsset,
            destMin: '5',
          },
        },
      ],
      {
        baseFeePerOperation: '100',
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: wallet.address,
          sequence: onChainAccount.sequenceNumber,
        },
      },
    );
    const xdr = transaction.getRaw().toXDR();
    createValidatedSwapTransaction.mockResolvedValueOnce(transaction);

    await handler.handle({
      ...request,
      params: {
        ...request.params,
        transaction: xdr,
        options: {
          sourceChainId: scope,
          destChainId: 'eip155:1',
        },
      },
    });

    expect(savePendingKeyringTransaction).toHaveBeenCalledWith({
      type: KeyringTransactionType.Pending,
      request: {
        txId: transactionId,
        account,
        scope,
        transactionType: TransactionType.BridgeSend,
        from: [
          {
            address: wallet.address,
            asset: {
              unit: 'XLM',
              type: KnownCaip19Slip44IdMap[scope],
              amount: '10',
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: wallet.address,
            asset: {
              unit: 'USDC',
              type: destinationAssetId,
              amount: '5',
              fungible: true,
            },
          },
        ],
        fees: [
          {
            type: FeeType.Base,
            asset: {
              unit: 'XLM',
              type: KnownCaip19Slip44IdMap[scope],
              amount: toDisplayBalance(transaction.totalFee),
              fungible: true,
            },
          },
        ],
      },
    });
  });

  describe('tracks transaction events', () => {
    it('tracks transaction submitted', async () => {
      const { handler, account, request, trackTransactionSubmittedSpy } =
        setup();
      await handler.handle(request);
      expect(trackTransactionSubmittedSpy).toHaveBeenCalledWith({
        accountType: account.type,
        chainIdCaip: scope,
        origin: METAMASK_ORIGIN,
      });
    });
  });
});
