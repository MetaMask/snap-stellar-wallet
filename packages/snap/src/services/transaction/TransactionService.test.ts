import {
  KeyringEvent,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { hexToBytes } from '@metamask/utils';

import { KeyringTransactionType } from './KeyringTransactionBuilder';
import { TransactionBuilder } from './TransactionBuilder';
import type { KnownCaip19ClassicAssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { getSlip44AssetId, getSnapProvider } from '../../utils';
import { createMockTransactionService } from './__mocks__/transaction.fixtures';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/account.fixtures';
import type { StellarKeyringAccount } from '../account/api';
import { NetworkService, TransactionRetryableException } from '../network';
import { TransactionScopeNotMatchException } from './exceptions';
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
  beforeEach(() => {
    jest.mocked(emitSnapKeyringEvent).mockReset();
    jest.mocked(emitSnapKeyringEvent).mockResolvedValue(undefined);
  });

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
            amount: '10000000',
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              symbol: 'XLM',
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
});
