import { hexToBytes } from '@metamask/utils';
import { Account, Keypair } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  AccountNotActivatedException,
  NetworkServiceException,
  WalletServiceException,
} from './exceptions';
import { NetworkService } from './NetworkService';
import { TransactionBuilder } from './TransactionBuilder';
import { Wallet } from './Wallet';
import { WalletService } from './WalletService';
import type { KnownCaip19AssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('WalletService', () => {
  let walletService: WalletService;
  let networkService: NetworkService;
  let transactionBuilder: TransactionBuilder;
  let testKeypair: Keypair;
  let testAddress: string;
  let testAccount: Account;
  let testWalletWithSigner: Wallet;
  let testAsset: KnownCaip19AssetId;
  let scope: KnownCaip2ChainId;

  const get32ByteSeedSpy: jest.Mock = jest.fn();
  const seed = hexToBytes(
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transactionBuilder = new TransactionBuilder({ logger });
    networkService = new NetworkService({ logger });

    walletService = new WalletService({
      logger,
      deriver: { get32ByteSeed: get32ByteSeedSpy.mockResolvedValue(seed) },
      networkService,
      transactionBuilder,
    });

    scope = KnownCaip2ChainId.Mainnet;
    testKeypair = Keypair.fromRawEd25519Seed(seed as Buffer);
    testAddress = testKeypair.publicKey();
    testAccount = new Account(testAddress, '1');
    testWalletWithSigner = new Wallet(testAccount, testKeypair);
    testAsset = `stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`;
  });

  const getNetworkServiceSpies = () => ({
    getBaseFeeSpy: jest.spyOn(NetworkService.prototype, 'getBaseFee'),
    pollTransactionSpy: jest.spyOn(NetworkService.prototype, 'pollTransaction'),
    loadAccountSpy: jest.spyOn(NetworkService.prototype, 'loadAccount'),
    sendTransactionSpy: jest.spyOn(NetworkService.prototype, 'send'),
  });

  const getTransactionBuilderSpies = () => ({
    rebuildTransactionSpy: jest.spyOn(
      TransactionBuilder.prototype,
      'rebuildTransaction',
    ),
  });

  const getWalletSpies = () => ({
    signTransactionSpy: jest.spyOn(Wallet.prototype, 'signTransaction'),
  });

  describe('builder', () => {
    it('returns the transaction builder', () => {
      expect(walletService.builder).toStrictEqual(transactionBuilder);
    });
  });

  describe('network', () => {
    it('returns the network service', () => {
      expect(walletService.network).toStrictEqual(networkService);
    });
  });

  describe('deriveAddress', () => {
    it('derives an address', async () => {
      const address = await walletService.deriveAddress({
        index: 0,
        entropySource: 'entropy-source-1',
      });

      expect(address).toStrictEqual(testAddress);
    });

    it('throws a WalletServiceException if the keypair derivation fails', async () => {
      get32ByteSeedSpy.mockRejectedValue(new Error('something went wrong'));

      await expect(
        walletService.deriveAddress({
          index: 0,
          entropySource: 'entropy-source-1',
        }),
      ).rejects.toThrow(WalletServiceException);
    });
  });

  describe('resolveActivatedAccount', () => {
    it('returns a wallet with loaded account', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      loadAccountSpy.mockResolvedValue(new Account(testAddress, '1'));

      const wallet = await walletService.resolveActivatedAccount({
        scope,
        entropySource: 'entropy-source-1',
        index: 0,
      });

      expect(wallet.address).toStrictEqual(testAddress);
      expect(wallet.account.accountId()).toStrictEqual(testAddress);
    });
  });

  describe('isAccountActivated', () => {
    it('returns true if the account is activated', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      loadAccountSpy.mockResolvedValue(new Account(testAddress, '1'));

      const result = await walletService.isAccountActivated({
        address: testAddress,
        scope,
      });
      expect(result).toBe(true);
    });

    it('returns false if the account is not activated', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      loadAccountSpy.mockRejectedValue(
        new AccountNotActivatedException(testAddress, scope),
      );

      const result = await walletService.isAccountActivated({
        address: testAddress,
        scope,
      });
      expect(result).toBe(false);
    });

    it('throws a NetworkServiceException if loading the account fails', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      loadAccountSpy.mockRejectedValue(
        new NetworkServiceException(
          'Failed to load account from Stellar Network',
        ),
      );

      await expect(
        walletService.isAccountActivated({ address: testAddress, scope }),
      ).rejects.toThrow(NetworkServiceException);
    });
  });

  describe('signTransaction', () => {
    it('signs a transaction', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      const { signTransactionSpy } = getWalletSpies();
      loadAccountSpy.mockResolvedValue(testAccount);

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        asset: testAsset,
        account: testWalletWithSigner,
      });

      const { rebuildTransactionSpy } = getTransactionBuilderSpies();
      rebuildTransactionSpy.mockReturnValue(testTransaction);

      await walletService.signTransaction({
        account: testWalletWithSigner,
        scope,
        transaction: testTransaction,
        baseFee: new BigNumber(100),
      });

      expect(rebuildTransactionSpy).toHaveBeenCalledWith({
        transaction: testTransaction,
        account: testAccount,
        baseFee: '100',
      });
      expect(loadAccountSpy).toHaveBeenCalledWith(testAddress, scope);
      expect(signTransactionSpy).toHaveBeenCalledWith(testTransaction);
    });

    it('fetches the base fee from the network if not provided', async () => {
      const { loadAccountSpy, getBaseFeeSpy } = getNetworkServiceSpies();
      loadAccountSpy.mockResolvedValue(testAccount);
      getBaseFeeSpy.mockResolvedValue(new BigNumber(100));

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        asset: testAsset,
        account: testWalletWithSigner,
      });

      const { rebuildTransactionSpy } = getTransactionBuilderSpies();
      rebuildTransactionSpy.mockReturnValue(testTransaction);

      await walletService.signTransaction({
        account: testWalletWithSigner,
        scope,
        transaction: testTransaction,
      });

      expect(rebuildTransactionSpy).toHaveBeenCalledWith({
        transaction: testTransaction,
        account: testAccount,
        baseFee: '100',
      });
      expect(getBaseFeeSpy).toHaveBeenCalledWith(scope);
    });

    it('throws a WalletServiceException if signing the transaction fails', async () => {
      const { loadAccountSpy } = getNetworkServiceSpies();
      const { signTransactionSpy } = getWalletSpies();
      loadAccountSpy.mockResolvedValue(testAccount);
      signTransactionSpy.mockImplementation(() => {
        throw new Error('Failed to sign transaction');
      });

      const testTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        asset: testAsset,
        account: testWalletWithSigner,
      });

      const { rebuildTransactionSpy } = getTransactionBuilderSpies();
      rebuildTransactionSpy.mockReturnValue(testTransaction);

      await expect(
        walletService.signTransaction({
          account: testWalletWithSigner,
          scope,
          transaction: testTransaction,
          baseFee: new BigNumber(100),
        }),
      ).rejects.toThrow(WalletServiceException);
    });
  });
});
