import {
  KeyringEvent,
  type Transaction as KeyringTransaction,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { hexToBytes } from '@metamask/utils';
import { Networks } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionScopeNotMatchException } from './exceptions';
import { KeyringTransactionType } from './KeyringTransactionBuilder';
import { TransactionBuilder } from './TransactionBuilder';
import type { KnownCaip19ClassicAssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { getSlip44AssetId, getSnapProvider } from '../../utils';
import {
  buildMockClassicTransaction,
  buildMockInvokeHostFunctionTransaction,
  createMockTransactionService,
  generateMockTransactions,
} from './__mocks__/transaction.fixtures';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/account.fixtures';
import type { StellarKeyringAccount } from '../account/api';
import {
  USDC_CLASSIC,
  USDC_SEP41,
} from '../asset-metadata/__mocks__/assets.fixtures';
import {
  AccountNotActivatedException,
  NetworkService,
  TransactionRetryableException,
} from '../network';
import { OnChainAccount } from '../on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
} from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';
import type { Wallet } from '../wallet/Wallet';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
}));

describe('TransactionService', () => {
  describe('savePendingKeyringTransaction', () => {
    it('creates and saves a pending send transaction', async () => {
      const { transactionService, transactionRepositorySaveManySpy } =
        createMockTransactionService();
      const [fromAccount, toAccount] = generateMockStellarKeyringAccounts(
        2,
        'test-entropy',
      ) as [StellarKeyringAccount, StellarKeyringAccount];

      const transaction =
        await transactionService.savePendingKeyringTransaction({
          type: KeyringTransactionType.Send,
          request: {
            txId: 'test-tx-id',
            account: fromAccount,
            scope: KnownCaip2ChainId.Mainnet,
            toAddress: toAccount.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '10000000',
              fungible: true as const,
            },
          },
        });

      const expectedTransaction = {
        type: TransactionType.Send,
        id: 'test-tx-id',
        from: [
          {
            address: fromAccount.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '10000000',
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: toAccount.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '10000000',
              fungible: true,
            },
          },
        ],
        events: [
          {
            status: TransactionStatus.Unconfirmed,
            timestamp: expect.any(Number),
          },
        ],
        chain: KnownCaip2ChainId.Mainnet,
        status: TransactionStatus.Unconfirmed,
        account: fromAccount.id,
        timestamp: expect.any(Number),
        fees: [],
      };

      expect(transaction).toStrictEqual(expectedTransaction);
      expect(transactionRepositorySaveManySpy).toHaveBeenCalledWith([
        expectedTransaction,
      ]);
      expect(emitSnapKeyringEvent).toHaveBeenCalledTimes(1);
      expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
        getSnapProvider(),
        KeyringEvent.AccountTransactionsUpdated,
        {
          transactions: {
            [fromAccount.id]: [expectedTransaction],
          },
        },
      );
    });
  });

  describe('createValidatedSwapTransaction', () => {
    const seed = hexToBytes(
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const scope = KnownCaip2ChainId.Mainnet;
    let testWalletWithSigner: Wallet;
    let testOnChainAccount: OnChainAccount;

    const buildFundedOnChainAccount = (
      accountId: string,
      sequenceNumber: string,
    ) => {
      const account = createMockAccountWithBalances(accountId, sequenceNumber, {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 500,
      });

      return new OnChainAccount(account, scope, horizonSource(account, scope));
    };

    beforeEach(() => {
      testWalletWithSigner = getTestWallet({ seed });
      testOnChainAccount = buildFundedOnChainAccount(
        testWalletWithSigner.address,
        '1',
      );
    });

    it('validates a classic path payment swap transaction with trustline setup', async () => {
      const { transactionService } = createMockTransactionService();
      const trustlineAsset = {
        code: 'USDC',
        issuer: getTestWallet().address,
      } as const;
      const loadOnChainAccountsSpy = jest.spyOn(
        NetworkService.prototype,
        'loadOnChainAccountsSafe',
      );
      loadOnChainAccountsSpy.mockResolvedValue([]);
      const simulateTransactionSpy = jest.spyOn(
        NetworkService.prototype,
        'simulateTransaction',
      );
      const transaction = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              asset: trustlineAsset,
              limit: '1000',
            },
          },
          {
            type: 'pathPaymentStrictSend',
            params: {
              sendAsset: 'native',
              sendAmount: '10',
              destination: testWalletWithSigner.address,
              destAsset: trustlineAsset,
              destMin: '5',
            },
          },
        ],
        {
          networkPassphrase: Networks.PUBLIC,
          source: {
            accountId: testWalletWithSigner.address,
            sequence: testOnChainAccount.sequenceNumber,
          },
        },
      );

      const result = await transactionService.createValidatedSwapTransaction({
        onChainAccount: testOnChainAccount,
        scope,
        xdr: transaction.getRaw().toXDR(),
      });

      expect(result.getRaw().toXDR()).toBe(transaction.getRaw().toXDR());
      expect(simulateTransactionSpy).not.toHaveBeenCalled();
      expect(loadOnChainAccountsSpy).toHaveBeenCalledWith([], scope);
    });

    it('validates a Soroban invoke swap transaction', async () => {
      const { transactionService } = createMockTransactionService();
      const loadOnChainAccountsSpy = jest.spyOn(
        NetworkService.prototype,
        'loadOnChainAccountsSafe',
      );
      loadOnChainAccountsSpy.mockResolvedValue([]);
      const simulateTransactionSpy = jest.spyOn(
        NetworkService.prototype,
        'simulateTransaction',
      );
      const transaction = buildMockInvokeHostFunctionTransaction('swap', [], {
        networkPassphrase: Networks.PUBLIC,
        source: {
          accountId: testWalletWithSigner.address,
          sequence: testOnChainAccount.sequenceNumber,
        },
      });
      simulateTransactionSpy.mockResolvedValue(transaction);

      const result = await transactionService.createValidatedSwapTransaction({
        onChainAccount: testOnChainAccount,
        scope,
        xdr: transaction.getRaw().toXDR(),
      });

      expect(result.getRaw().toXDR()).toBe(transaction.getRaw().toXDR());
      expect(simulateTransactionSpy).toHaveBeenCalledTimes(1);
      expect(loadOnChainAccountsSpy).toHaveBeenCalledWith([], scope);
    });
  });

  describe('savePendingKeyringTransactionSafe', () => {
    it('returns saved transaction when savePendingKeyringTransaction succeeds', async () => {
      const { transactionService } = createMockTransactionService();
      const [account] = generateMockStellarKeyringAccounts(
        1,
        'safe-save-entropy',
      ) as [StellarKeyringAccount];

      const txId =
        '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1';
      const savePendingKeyringTransactionSpy = jest
        .spyOn(transactionService, 'savePendingKeyringTransaction')
        .mockResolvedValue(
          generateMockTransactions(1, {
            id: txId,
            account: account.id,
            scope: KnownCaip2ChainId.Mainnet,
          })[0] as KeyringTransaction,
        );

      const result = await transactionService.savePendingKeyringTransactionSafe(
        {
          type: KeyringTransactionType.Send,
          request: {
            txId,
            account,
            scope: KnownCaip2ChainId.Mainnet,
            toAddress: account.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '1',
              fungible: true as const,
            },
          },
        },
      );

      expect(savePendingKeyringTransactionSpy).toHaveBeenCalledTimes(1);
      expect(result).toStrictEqual(
        expect.objectContaining({
          id: txId,
          account: account.id,
        }),
      );
    });

    it('returns null when savePendingKeyringTransaction throws', async () => {
      const { transactionService } = createMockTransactionService();
      const [account] = generateMockStellarKeyringAccounts(
        1,
        'safe-save-error-entropy',
      ) as [StellarKeyringAccount];

      jest
        .spyOn(transactionService, 'savePendingKeyringTransaction')
        .mockRejectedValue(new Error('save failed'));

      const result = await transactionService.savePendingKeyringTransactionSafe(
        {
          type: KeyringTransactionType.Send,
          request: {
            txId: '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1',
            account,
            scope: KnownCaip2ChainId.Mainnet,
            toAddress: account.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '1',
              fungible: true as const,
            },
          },
        },
      );

      expect(result).toBeNull();
    });
  });

  describe('sendTransaction', () => {
    const seed = hexToBytes(
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    let testWalletWithSigner: Wallet;
    let testOnChainAccount: OnChainAccount;
    let testAsset: KnownCaip19ClassicAssetId;
    let scope: KnownCaip2ChainId;

    const getNetworkServiceSpies = () => ({
      getAccountSpy: jest.spyOn(NetworkService.prototype, 'getAccount'),
    });

    const getTransactionBuilderSpies = () => ({
      rebuildTxnWithNewSeqSpy: jest.spyOn(
        TransactionBuilder.prototype,
        'rebuildTxnWithNewSeq',
      ),
    });

    beforeEach(() => {
      testWalletWithSigner = getTestWallet({ seed });
      const acc = createMockAccountWithBalances(
        testWalletWithSigner.address,
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      testOnChainAccount = new OnChainAccount(
        acc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(acc, KnownCaip2ChainId.Mainnet),
      );
      testAsset =
        'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      scope = KnownCaip2ChainId.Mainnet;
    });

    it('returns hash when send succeeds on first attempt', async () => {
      const { transactionService, transactionBuilder } =
        createMockTransactionService();
      const sendSpy = jest.spyOn(NetworkService.prototype, 'send');
      sendSpy.mockResolvedValue('abc123hash');

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });
      testWalletWithSigner.signTransaction(testTransaction);

      const result = await transactionService.sendTransaction({
        wallet: testWalletWithSigner,
        onChainAccount: testOnChainAccount,
        scope,
        transaction: testTransaction,
      });

      expect(result).toBe('abc123hash');
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith({
        transaction: testTransaction,
        scope,
        pollTransaction: false,
      });
    });

    it('throws TransactionScopeNotMatchException when transaction scope does not match params.scope', async () => {
      const { transactionService, transactionBuilder } =
        createMockTransactionService();
      const testnetUsdc: KnownCaip19ClassicAssetId =
        'stellar:testnet/asset:USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Testnet,
        assetId: testnetUsdc,
        onChainAccount: testOnChainAccount,
      });
      testWalletWithSigner.signTransaction(testTransaction);

      await expect(
        transactionService.sendTransaction({
          wallet: testWalletWithSigner,
          onChainAccount: testOnChainAccount,
          scope: KnownCaip2ChainId.Mainnet,
          transaction: testTransaction,
        }),
      ).rejects.toThrow(TransactionScopeNotMatchException);
    });

    it('resigns and retries once when send fails with txBadSeq', async () => {
      const { transactionService, transactionBuilder } =
        createMockTransactionService();
      const sendSpy = jest.spyOn(NetworkService.prototype, 'send');
      sendSpy
        .mockRejectedValueOnce(
          new TransactionRetryableException(scope, 'txBadSeq'),
        )
        .mockResolvedValueOnce('retry-hash');

      const { getAccountSpy } = getNetworkServiceSpies();
      getAccountSpy.mockResolvedValue(testOnChainAccount);

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });
      testWalletWithSigner.signTransaction(testTransaction);

      const resignedTx = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });
      const { rebuildTxnWithNewSeqSpy } = getTransactionBuilderSpies();
      rebuildTxnWithNewSeqSpy.mockReturnValue(resignedTx);

      const result = await transactionService.sendTransaction({
        wallet: testWalletWithSigner,
        onChainAccount: testOnChainAccount,
        scope,
        transaction: testTransaction,
      });

      expect(result).toBe('retry-hash');
      expect(sendSpy).toHaveBeenCalledTimes(2);
      const secondSendArgs = sendSpy.mock.calls[1];
      expect(secondSendArgs).toBeDefined();
      expect(secondSendArgs?.[0].transaction).toStrictEqual(resignedTx);
      expect(rebuildTxnWithNewSeqSpy).toHaveBeenCalledWith({
        transaction: testTransaction,
        sequenceNumber: testOnChainAccount.sequenceNumber,
      });
    });

    it('rethrows txBadSeq when transaction source is not the wallet account', async () => {
      const { transactionService, transactionBuilder } =
        createMockTransactionService();
      const sendSpy = jest.spyOn(NetworkService.prototype, 'send');
      sendSpy.mockRejectedValue(
        new TransactionRetryableException(scope, 'txBadSeq'),
      );

      const otherSeed = hexToBytes(
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      );
      const sourceWallet = getTestWallet({ seed: otherSeed });
      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      const sourceOnChainAccount = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );
      const wrongWallet = getTestWallet({ seed });

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        assetId: testAsset,
        onChainAccount: sourceOnChainAccount,
      });
      sourceWallet.signTransaction(testTransaction);

      const { getAccountSpy, rebuildTxnWithNewSeqSpy } = {
        ...getNetworkServiceSpies(),
        ...getTransactionBuilderSpies(),
      };

      await expect(
        transactionService.sendTransaction({
          wallet: wrongWallet,
          onChainAccount: testOnChainAccount,
          scope,
          transaction: testTransaction,
        }),
      ).rejects.toThrow(TransactionRetryableException);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(getAccountSpy).not.toHaveBeenCalled();
      expect(rebuildTxnWithNewSeqSpy).not.toHaveBeenCalled();
    });
  });

  describe('createValidatedSendTransaction', () => {
    it('returns a payment transaction for native XLM to an activated destination', async () => {
      const { transactionService } = createMockTransactionService();
      const sourceWallet = getTestWallet();
      const destWallet = getTestWallet();

      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        { ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES, nativeBalance: 500 },
      );
      const sourceOnChain = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );

      const destAcc = createMockAccountWithBalances(destWallet.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 50,
      });
      const destOnChain = new OnChainAccount(
        destAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(destAcc, KnownCaip2ChainId.Mainnet),
      );

      jest
        .spyOn(NetworkService.prototype, 'loadOnChainAccount')
        .mockResolvedValue(destOnChain);
      jest
        .spyOn(NetworkService.prototype, 'getBaseFee')
        .mockResolvedValue(new BigNumber('100'));

      const tx = await transactionService.createValidatedSendTransaction({
        onChainAccount: sourceOnChain,
        amount: new BigNumber('1000000'),
        scope: KnownCaip2ChainId.Mainnet,
        assetId: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
        destination: destWallet.address,
      });

      expect(tx.transactionOperations).toHaveLength(1);
      expect(tx.transactionOperations[0]?.type).toBe('payment');
    });

    it('returns a createAccount transaction for native XLM to an unfunded destination', async () => {
      const { transactionService } = createMockTransactionService();
      const sourceWallet = getTestWallet();
      const unfundedDestination = getTestWallet().address;

      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        { ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES, nativeBalance: 500 },
      );
      const sourceOnChain = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );

      jest
        .spyOn(NetworkService.prototype, 'loadOnChainAccount')
        .mockRejectedValue(
          new AccountNotActivatedException(
            unfundedDestination,
            KnownCaip2ChainId.Mainnet,
          ),
        );
      jest
        .spyOn(NetworkService.prototype, 'getBaseFee')
        .mockResolvedValue(new BigNumber('100'));

      const tx = await transactionService.createValidatedSendTransaction({
        onChainAccount: sourceOnChain,
        amount: new BigNumber('20000000'),
        scope: KnownCaip2ChainId.Mainnet,
        assetId: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
        destination: unfundedDestination,
      });

      expect(tx.hasCreateAccount).toBe(true);
    });

    it('returns a SEP-41 transfer transaction when destination is activated', async () => {
      const { transactionService } = createMockTransactionService();
      const sourceWallet = getTestWallet();
      const destWallet = getTestWallet();

      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        { ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES, nativeBalance: 500 },
      );
      const sourceOnChain = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );

      const destAcc = createMockAccountWithBalances(destWallet.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 50,
      });
      const destOnChain = new OnChainAccount(
        destAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(destAcc, KnownCaip2ChainId.Mainnet),
      );

      jest
        .spyOn(NetworkService.prototype, 'loadOnChainAccount')
        .mockResolvedValue(destOnChain);
      jest
        .spyOn(NetworkService.prototype, 'simulateTransaction')
        .mockImplementation(async (transaction) => transaction);
      jest
        .spyOn(NetworkService.prototype, 'getSep41AssetBalances')
        .mockResolvedValue({
          [sourceWallet.address]: {
            [USDC_SEP41]: new BigNumber(1_000_000),
          },
        });

      const tx = await transactionService.createValidatedSendTransaction({
        onChainAccount: sourceOnChain,
        amount: new BigNumber('100'),
        scope: KnownCaip2ChainId.Mainnet,
        assetId: USDC_SEP41,
        destination: destWallet.address,
      });

      expect(tx.hasInvokeHostFunction).toBe(true);
    });

    it('throws AccountNotActivatedException when sending a classic asset to an unfunded destination', async () => {
      const { transactionService } = createMockTransactionService();
      const sourceWallet = getTestWallet();
      const unfundedDestination = getTestWallet().address;

      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 500,
          assets: [
            {
              assetType: 'credit_alphanum4',
              assetCode: 'USDC',
              assetIssuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              balance: 1000,
            },
          ],
        },
      );
      const sourceOnChain = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );

      jest
        .spyOn(NetworkService.prototype, 'loadOnChainAccount')
        .mockRejectedValue(
          new AccountNotActivatedException(
            unfundedDestination,
            KnownCaip2ChainId.Mainnet,
          ),
        );

      const error = await transactionService
        .createValidatedSendTransaction({
          onChainAccount: sourceOnChain,
          amount: new BigNumber('1000000'),
          scope: KnownCaip2ChainId.Mainnet,
          assetId: USDC_CLASSIC,
          destination: unfundedDestination,
        })
        .then(
          () => {
            throw new Error('expected rejection');
          },
          (rejection: unknown) => rejection,
        );

      expect(error).toBeInstanceOf(AccountNotActivatedException);
      expect((error as AccountNotActivatedException).address).toBe(
        unfundedDestination,
      );
      expect((error as AccountNotActivatedException).scope).toBe(
        KnownCaip2ChainId.Mainnet,
      );
    });

    it('throws AccountNotActivatedException when sending SEP-41 to an unfunded destination', async () => {
      const { transactionService } = createMockTransactionService();
      const sourceWallet = getTestWallet();
      const unfundedDestination = getTestWallet().address;

      const sourceAcc = createMockAccountWithBalances(
        sourceWallet.address,
        '1',
        { ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES, nativeBalance: 500 },
      );
      const sourceOnChain = new OnChainAccount(
        sourceAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(sourceAcc, KnownCaip2ChainId.Mainnet),
      );

      jest
        .spyOn(NetworkService.prototype, 'loadOnChainAccount')
        .mockRejectedValue(
          new AccountNotActivatedException(
            unfundedDestination,
            KnownCaip2ChainId.Mainnet,
          ),
        );

      const error = await transactionService
        .createValidatedSendTransaction({
          onChainAccount: sourceOnChain,
          amount: new BigNumber('100'),
          scope: KnownCaip2ChainId.Mainnet,
          assetId: USDC_SEP41,
          destination: unfundedDestination,
        })
        .then(
          () => {
            throw new Error('expected rejection');
          },
          (rejection: unknown) => rejection,
        );

      expect(error).toBeInstanceOf(AccountNotActivatedException);
      expect((error as AccountNotActivatedException).address).toBe(
        unfundedDestination,
      );
      expect((error as AccountNotActivatedException).scope).toBe(
        KnownCaip2ChainId.Mainnet,
      );
    });
  });
});
