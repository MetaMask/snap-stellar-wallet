import { hexToBytes } from '@metamask/utils';
import {
  Account,
  Keypair,
  Networks,
  Transaction as StellarTransaction,
  TransactionBuilder as StellarSdkTransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionBuilderException } from './exceptions';
import { Transaction } from './Transaction';
import { TransactionBuilder } from './TransactionBuilder';
import { Wallet } from './Wallet';
import type { KnownCaip19AssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('TransactionBuilder', () => {
  let transactionBuilder: TransactionBuilder;
  let testAsset: KnownCaip19AssetId;
  let testWalletWithSigner: Wallet;
  let testAccount: Account;
  let testKeypair: Keypair;
  let testAddress: string;

  beforeEach(() => {
    transactionBuilder = new TransactionBuilder({ logger });
    testAsset = `stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`;
    testKeypair = Keypair.fromRawEd25519Seed(
      hexToBytes(
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      ) as Buffer,
    );
    testAddress = testKeypair.publicKey();
    testAccount = new Account(testAddress, '100');
    testWalletWithSigner = new Wallet(testAccount, testKeypair);
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
        asset: testAsset,
        account: testWalletWithSigner,
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.getTotalFee()).toStrictEqual(new BigNumber(100));
      expect(transaction.getOperationCount()).toBe(1);
      expect(transaction.getNetworkPassphrase()).toStrictEqual(Networks.PUBLIC);
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
          asset: testAsset,
          account: testWalletWithSigner,
        });
      }).toThrow(TransactionBuilderException);
    });
  });

  describe('rebuildTransaction', () => {
    it('rebuilds a transaction', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        asset: testAsset,
        account: new Wallet(new Account(testAddress, '1'), null),
      });

      const rebuiltTransaction = transactionBuilder.rebuildTransaction({
        transaction,
        // Use the test wallet that has sequence number 100
        account: testWalletWithSigner.account,
        baseFee: '100',
      });

      expect(rebuiltTransaction).toBeInstanceOf(Transaction);
      expect(rebuiltTransaction.getTotalFee()).toStrictEqual(
        new BigNumber(100),
      );
      expect(rebuiltTransaction.getOperationCount()).toBe(1);
      expect(rebuiltTransaction.getNetworkPassphrase()).toStrictEqual(
        Networks.PUBLIC,
      );
      expect(rebuiltTransaction.getRaw()).toBeInstanceOf(StellarTransaction);
      // The sequence number should be incremented by 1
      expect(rebuiltTransaction.getRaw().sequence).toBe('101');
    });

    it('throws a TransactionBuilderException if rebuilding the transaction fails', () => {
      const transaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope: KnownCaip2ChainId.Mainnet,
        asset: testAsset,
        account: new Wallet(new Account(testAddress, '1'), null),
      });

      const { buildSpy } = getTransactionBuilderSpies();
      buildSpy.mockImplementation(() => {
        throw new Error('Failed to build transaction');
      });

      expect(() => {
        transactionBuilder.rebuildTransaction({
          transaction,
          account: testWalletWithSigner.account,
          baseFee: '100',
        });
      }).toThrow(TransactionBuilderException);
    });
  });
});
