import {
  Account,
  Keypair,
  Networks,
  Transaction as StellarTransaction,
  TransactionBuilder as StellarSdkTransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  InvalidAssetForCreateAccountException,
  TransactionBuilderException,
} from './exceptions';
import { Transaction } from './Transaction';
import { TransactionBuilder } from './TransactionBuilder';
import type { KnownCaip19ClassicAssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { getSlip44AssetId, toSmallestUnit } from '../../utils';
import { logger } from '../../utils/logger';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
} from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';
import type { Wallet } from '../wallet/Wallet';

jest.mock('../../utils/logger');

describe('TransactionBuilder', () => {
  let transactionBuilder: TransactionBuilder;
  let testAsset: KnownCaip19ClassicAssetId;
  let testWalletWithSigner: Wallet;
  let testOnChainAccount: OnChainAccount;

  beforeEach(() => {
    transactionBuilder = new TransactionBuilder({ logger });
    testAsset = `stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`;
    testWalletWithSigner = getTestWallet();
    testOnChainAccount = new OnChainAccount(
      createMockAccountWithBalances(
        testWalletWithSigner.address,
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      ),
      KnownCaip2ChainId.Mainnet,
    );
  });

  const getAccountSpies = () => ({
    incrementSequenceNumberSpy: jest.spyOn(
      Account.prototype,
      'incrementSequenceNumber',
    ),
  });

  const getTransactionBuilderSpies = () => ({
    buildSpy: jest.spyOn(StellarSdkTransactionBuilder.prototype, 'build'),
  });

  describe('changeTrust', () => {
    it('builds a change trust transaction', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.totalFee).toStrictEqual(new BigNumber(100));
      expect(transaction.operationCount).toBe(1);
      expect(transaction.network).toStrictEqual(Networks.PUBLIC);
      expect(transaction.getRaw()).toBeInstanceOf(StellarTransaction);
    });

    it('throws a TransactionBuilderException if building the transaction fails', () => {
      const { incrementSequenceNumberSpy } = getAccountSpies();
      incrementSequenceNumberSpy.mockImplementation(() => {
        throw new Error('Failed to increment sequence number');
      });

      expect(() => {
        transactionBuilder.changeTrust({
          baseFee: '100',
          scope: KnownCaip2ChainId.Mainnet,
          assetId: testAsset,
          onChainAccount: testOnChainAccount,
        });
      }).toThrow(TransactionBuilderException);
    });
  });

  describe('rebuildTxnWithNewSeq', () => {
    it('rebuilds a transaction', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });

      const rebuiltTransaction = transactionBuilder.rebuildTxnWithNewSeq({
        transaction,
        sequenceNumber: new OnChainAccount(
          createMockAccountWithBalances(
            getTestWallet().address,
            '100',
            DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          ),
          KnownCaip2ChainId.Mainnet,
        ).sequenceNumber,
      });

      expect(rebuiltTransaction).toBeInstanceOf(Transaction);
      expect(rebuiltTransaction.totalFee).toStrictEqual(new BigNumber(100));
      expect(rebuiltTransaction.operationCount).toBe(1);
      expect(rebuiltTransaction.network).toStrictEqual(Networks.PUBLIC);
      const rebuiltRaw = rebuiltTransaction.getRaw();
      expect(rebuiltRaw).toBeInstanceOf(StellarTransaction);
      expect((rebuiltRaw as StellarTransaction).sequence).toBe('101');
    });

    it('throws a TransactionBuilderException if rebuilding the transaction fails', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });

      const { buildSpy } = getTransactionBuilderSpies();
      buildSpy.mockImplementation(() => {
        throw new Error('Failed to build transaction');
      });

      expect(() => {
        transactionBuilder.rebuildTxnWithNewSeq({
          transaction,
          sequenceNumber: testOnChainAccount.sequenceNumber,
        });
      }).toThrow(TransactionBuilderException);
    });

    it('drops prior signatures when the envelope was signed by another keypair', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });

      const signedRaw = transaction.getRaw() as StellarTransaction;
      signedRaw.sign(Keypair.random());

      expect(signedRaw.signatures.length).toBeGreaterThan(0);

      const sameSourceOnChainAccount = new OnChainAccount(
        createMockAccountWithBalances(testWalletWithSigner.address, '42', {
          nativeBalance: 10,
          subentryCount: 0,
          assets: [],
        }),
        KnownCaip2ChainId.Mainnet,
      );

      const rebuilt = transactionBuilder.rebuildTxnWithNewSeq({
        transaction,
        sequenceNumber: sameSourceOnChainAccount.sequenceNumber,
      });

      const rebuiltRaw = rebuilt.getRaw() as StellarTransaction;
      expect(rebuiltRaw.signatures).toHaveLength(0);
    });
  });

  describe('transfer', () => {
    it('builds a transfer transaction', () => {
      const testDestination = getTestWallet();
      const transaction = transactionBuilder.transfer({
        onChainAccount: testOnChainAccount,
        scope: KnownCaip2ChainId.Mainnet,
        assetId: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
        amount: new BigNumber(100),
        destination: {
          address: testDestination.address,
          isActivated: true,
        },
        baseFee: new BigNumber(100),
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.totalFee).toStrictEqual(new BigNumber(100));
      expect(transaction.operationCount).toBe(1);
      expect(transaction.network).toStrictEqual(Networks.PUBLIC);
      expect(transaction.getRaw()).toBeInstanceOf(StellarTransaction);
      expect(transaction.hasCreateAccount).toBe(false);
    });

    it('builds a create account transaction', () => {
      const testDestination = getTestWallet();
      const transaction = transactionBuilder.transfer({
        onChainAccount: testOnChainAccount,
        scope: KnownCaip2ChainId.Mainnet,
        assetId: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
        amount: toSmallestUnit(BigNumber(1)),
        destination: {
          address: testDestination.address,
          isActivated: false,
        },
        baseFee: new BigNumber(100),
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.totalFee).toStrictEqual(new BigNumber(100));
      expect(transaction.operationCount).toBe(1);
      expect(transaction.network).toStrictEqual(Networks.PUBLIC);
      expect(transaction.getRaw()).toBeInstanceOf(StellarTransaction);
      expect(transaction.hasCreateAccount).toBe(true);
    });

    it('throws a InvalidAssetForCreateAccountException if the asset is not a native asset', () => {
      expect(() => {
        const testDestination = getTestWallet();
        transactionBuilder.transfer({
          onChainAccount: testOnChainAccount,
          scope: KnownCaip2ChainId.Mainnet,
          assetId: testAsset,
          amount: toSmallestUnit(BigNumber(1)),
          destination: {
            address: testDestination.address,
            isActivated: false,
          },
          baseFee: new BigNumber(100),
        });
      }).toThrow(InvalidAssetForCreateAccountException);
    });
  });

  describe('deserialize', () => {
    it('builds a transaction from an XDR string', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        assetId: testAsset,
        onChainAccount: testOnChainAccount,
      });

      const fromXDRTransaction = transactionBuilder.deserialize({
        xdr: transaction.getRaw().toXDR(),
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(fromXDRTransaction).toBeInstanceOf(Transaction);
      expect(fromXDRTransaction.totalFee).toStrictEqual(new BigNumber(100));
      expect(fromXDRTransaction.operationCount).toBe(1);
      expect(fromXDRTransaction.network).toStrictEqual(Networks.PUBLIC);
      expect(fromXDRTransaction.getRaw()).toBeInstanceOf(StellarTransaction);
    });
  });

  describe('sep41Transfer', () => {
    const sep41AssetId =
      `stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J` as const;

    it('builds a sep41 transfer transaction', () => {
      const testDestination = getTestWallet();
      const transaction = transactionBuilder.sep41Transfer({
        scope: KnownCaip2ChainId.Mainnet,
        onChainAccount: testOnChainAccount,
        assetId: sep41AssetId,
        destination: testDestination.address,
        amount: new BigNumber(100000000),
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.operationCount).toBe(1);
      expect(transaction.network).toStrictEqual(Networks.PUBLIC);
      expect(transaction.getRaw()).toBeInstanceOf(StellarTransaction);
      expect(transaction.hasInvokeHostFunction).toBe(true);
    });

    it('throws a TransactionBuilderException if building the transaction fails', () => {
      expect(() => {
        const testDestination = getTestWallet();
        const { buildSpy } = getTransactionBuilderSpies();
        buildSpy.mockImplementation(() => {
          throw new Error('Failed to build transaction');
        });

        transactionBuilder.sep41Transfer({
          scope: KnownCaip2ChainId.Mainnet,
          onChainAccount: testOnChainAccount,
          assetId: sep41AssetId,
          destination: testDestination.address,
          amount: new BigNumber(100000000),
        });
      }).toThrow(TransactionBuilderException);
    });
  });
});
