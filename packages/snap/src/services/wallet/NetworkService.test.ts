import { hexToBytes } from '@metamask/utils';
import {
  Account,
  Keypair,
  Horizon as StellarHorizon,
  rpc as StellarRpc,
  NotFoundError,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  AccountLoadException,
  AccountNotActivatedException,
  BaseFeeFetchException,
  NetworkServiceException,
  TransactionPollException,
} from './exceptions';
import { NetworkService } from './NetworkService';
import type { Transaction } from './Transaction';
import { TransactionBuilder } from './TransactionBuilder';
import { Wallet } from './Wallet';
import type { KnownCaip19AssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('NetworkService', () => {
  let networkService: NetworkService;
  const testAddress =
    'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';
  const testTransactionHash =
    '58b5e4cd7319962ecbfbdaa7a3b9444c9117e130935da4f14a695dd5d1423d0a';
  let scope: KnownCaip2ChainId;

  beforeEach(() => {
    jest.clearAllMocks();
    networkService = new NetworkService({ logger });
    scope = KnownCaip2ChainId.Mainnet;
  });

  const getHorizonClientSpies = () => ({
    fetchBaseFeeSpy: jest.spyOn(
      StellarHorizon.Server.prototype,
      'fetchBaseFee',
    ),
    loadAccountSpy: jest.spyOn(StellarHorizon.Server.prototype, 'loadAccount'),
  });

  const getRpcServerSpies = () => ({
    pollTransactionSpy: jest.spyOn(
      StellarRpc.Server.prototype,
      'pollTransaction',
    ),
    sendTransactionSpy: jest.spyOn(
      StellarRpc.Server.prototype,
      'sendTransaction',
    ),
  });

  describe('getBaseFee', () => {
    it('returns base fee as BigNumber', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockResolvedValue(100);

      const result = await networkService.getBaseFee(scope);

      expect(result).toStrictEqual(new BigNumber(100));
      expect(fetchBaseFeeSpy).toHaveBeenCalled();
    });

    it('throws BaseFeeFetchException when fetch fails', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockRejectedValue(new Error('Network error'));

      await expect(networkService.getBaseFee(scope)).rejects.toThrow(
        BaseFeeFetchException,
      );
    });
  });

  describe('loadAccount', () => {
    it('returns loaded account', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      const account = new Account(testAddress, '1');
      loadAccountSpy.mockResolvedValue(
        account as unknown as StellarHorizon.AccountResponse,
      );

      const result = await networkService.loadAccount(testAddress, scope);

      expect(result).toStrictEqual(account);
      expect(result.accountId()).toStrictEqual(testAddress);
      expect(loadAccountSpy).toHaveBeenCalledWith(testAddress);
    });

    it('throws AccountNotActivatedException when account is not found', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new NotFoundError('not found', {}));

      await expect(
        networkService.loadAccount(testAddress, scope),
      ).rejects.toThrow(AccountNotActivatedException);
    });

    it('throws AccountLoadException when load fails for other reason', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new Error('Network error'));

      await expect(
        networkService.loadAccount(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });
  });

  describe('pollTransaction', () => {
    it('returns transaction hash when status is SUCCESS', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      pollTransactionSpy.mockResolvedValue({
        status: StellarRpc.Api.GetTransactionStatus.SUCCESS,
        txHash: testTransactionHash,
      } as unknown as StellarRpc.Api.GetSuccessfulTransactionResponse);

      const result = await networkService.pollTransaction(
        testTransactionHash,
        scope,
      );

      expect(result).toStrictEqual(testTransactionHash);
      expect(pollTransactionSpy).toHaveBeenCalledWith(testTransactionHash);
    });

    it('throws TransactionPollException when status is not SUCCESS', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      pollTransactionSpy.mockResolvedValue({
        status: StellarRpc.Api.GetTransactionStatus.FAILED,
        txHash: testTransactionHash,
      } as unknown as StellarRpc.Api.GetFailedTransactionResponse);

      await expect(
        networkService.pollTransaction(testTransactionHash, scope),
      ).rejects.toThrow(TransactionPollException);
    });

    it('throws TransactionPollException when poll fails', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      pollTransactionSpy.mockRejectedValue(new Error('RPC error'));

      await expect(
        networkService.pollTransaction(testTransactionHash, scope),
      ).rejects.toThrow(TransactionPollException);
    });
  });

  describe('send', () => {
    let mockTransaction: Transaction;
    let transactionBuilder: TransactionBuilder;
    const testAsset: KnownCaip19AssetId = `stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`;

    beforeEach(() => {
      transactionBuilder = new TransactionBuilder({ logger });
      const seed = hexToBytes(
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      ) as Buffer;
      const testWallet = new Wallet(
        new Account(Keypair.fromRawEd25519Seed(seed).publicKey(), '1'),
        null,
      );
      mockTransaction = transactionBuilder.changeTrust({
        baseFee: '100',
        scope,
        asset: testAsset,
        account: testWallet,
      });
    });

    it('returns transaction hash when pollTransaction is false', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);

      const result = await networkService.send({
        transaction: mockTransaction,
        scope,
        pollTransaction: false,
      });

      expect(result).toStrictEqual(testTransactionHash);
      expect(sendTransactionSpy).toHaveBeenCalledWith(mockTransaction.getRaw());
      expect(pollTransactionSpy).not.toHaveBeenCalled();
    });

    it('polls and returns hash when pollTransaction is true and status is SUCCESS', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);
      pollTransactionSpy.mockResolvedValue({
        status: StellarRpc.Api.GetTransactionStatus.SUCCESS,
        txHash: testTransactionHash,
      } as unknown as StellarRpc.Api.GetSuccessfulTransactionResponse);

      const result = await networkService.send({
        transaction: mockTransaction,
        scope,
        pollTransaction: true,
      });

      expect(result).toStrictEqual(testTransactionHash);
      expect(pollTransactionSpy).toHaveBeenCalledWith(testTransactionHash);
    });

    it('throws TransactionPollException when pollTransaction is true and poll fails', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);
      pollTransactionSpy.mockRejectedValue(new Error('RPC error'));

      await expect(
        networkService.send({
          transaction: mockTransaction,
          scope,
          pollTransaction: true,
        }),
      ).rejects.toThrow(TransactionPollException);
    });
  });

  describe('#getHorizonClient', () => {
    it('creates and returns a new Horizon client when it is not already created', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockResolvedValue(100);

      await networkService.getBaseFee(scope);

      expect(fetchBaseFeeSpy).toHaveBeenCalled();
    });

    it('throws NetworkServiceException when corresponding Config is not found for the given scope', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();

      await expect(
        networkService.getBaseFee('unknown' as unknown as KnownCaip2ChainId),
      ).rejects.toThrow(NetworkServiceException);
      expect(fetchBaseFeeSpy).not.toHaveBeenCalled();
    });
  });

  describe('#getRpcClient', () => {
    it('creates and returns a new RPC client when it is not already created', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      pollTransactionSpy.mockResolvedValue({
        status: StellarRpc.Api.GetTransactionStatus.SUCCESS,
        txHash: testTransactionHash,
      } as unknown as StellarRpc.Api.GetSuccessfulTransactionResponse);

      await networkService.pollTransaction(testTransactionHash, scope);
      expect(pollTransactionSpy).toHaveBeenCalled();
    });

    it('throws NetworkServiceException when corresponding Config is not found for the given scope', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();

      await expect(
        networkService.pollTransaction(
          testTransactionHash,
          'unknown' as unknown as KnownCaip2ChainId,
        ),
      ).rejects.toThrow(NetworkServiceException);
      expect(pollTransactionSpy).not.toHaveBeenCalled();
    });
  });
});
