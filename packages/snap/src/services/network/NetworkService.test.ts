import {
  Account,
  Horizon as StellarHorizon,
  rpc as StellarRpc,
  NotFoundError,
  xdr,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { KnownRpcError } from './api';
import {
  AccountLoadException,
  AccountNotActivatedException,
  AssetDataFetchException,
  BaseFeeFetchException,
  NetworkServiceException,
  SimulationException,
  TransactionPollException,
  TransactionRetryableException,
  TransactionSendException,
} from './exceptions';
import { MultiCall } from './MultiCall';
import { NetworkService } from './NetworkService';
import type { KnownCaip19Sep41AssetId } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { logger } from '../../utils/logger';
import { createMockAccountWithBalances } from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import {
  buildMockClassicTransaction,
  buildMockInvokeHostFunctionTransaction,
} from '../transaction/__mocks__/transaction.fixtures';
import { generateStellarAddress } from '../wallet/__mocks__/wallet.fixtures';

jest.mock('../../utils/logger');

describe('NetworkService', () => {
  let networkService: NetworkService;

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
    getAccountSpy: jest.spyOn(StellarRpc.Server.prototype, 'getAccount'),
    getLedgerEntriesSpy: jest.spyOn(
      StellarRpc.Server.prototype,
      'getLedgerEntries',
    ),
    simulateTransactionSpy: jest.spyOn(
      StellarRpc.Server.prototype,
      'simulateTransaction',
    ),
  });

  const validSep41AssetId =
    'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as KnownCaip19Sep41AssetId;

  const createMockTransaction = (accountId?: string) => {
    return buildMockClassicTransaction([
      {
        type: 'payment',
        params: {
          destination: accountId ?? generateStellarAddress(),
          asset: 'native',
          amount: '1',
        },
      },
    ]);
  };

  const createMockInvokeHostFunctionTransaction = (accountId?: string) => {
    return buildMockInvokeHostFunctionTransaction('invokeHostFunction', [], {
      contractId: 'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT',
      source: {
        accountId: accountId ?? generateStellarAddress(),
        sequence: '1',
      },
    });
  };

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

  describe('loadOnChainAccount', () => {
    const testAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('returns loaded account', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      const account = createMockAccountWithBalances(testAddress, '1', {
        nativeBalance: 1,
        assets: [],
      });

      loadAccountSpy.mockResolvedValue(
        account as unknown as StellarHorizon.AccountResponse,
      );

      const result = await networkService.loadOnChainAccount(
        testAddress,
        scope,
      );

      expect(result).toBeInstanceOf(OnChainAccount);
      expect(result.accountId).toStrictEqual(testAddress);
      expect(result.sequenceNumber).toStrictEqual(account.sequenceNumber());
      expect(loadAccountSpy).toHaveBeenCalledWith(testAddress);
    });

    it('throws AccountNotActivatedException when account is not found', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new NotFoundError('not found', {}));

      await expect(
        networkService.loadOnChainAccount(testAddress, scope),
      ).rejects.toThrow(AccountNotActivatedException);
    });

    it('throws AccountLoadException when load fails for other reason', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new Error('Network error'));

      await expect(
        networkService.loadOnChainAccount(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });
  });

  describe('loadActivatedAccountOrNull', () => {
    const testAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('returns null when the account is not on-chain', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new NotFoundError('not found', {}));

      const result = await networkService.loadActivatedAccountOrNull(
        testAddress,
        scope,
      );
      expect(result).toBeNull();
    });

    it('returns OnChainAccount when the account exists', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      const account = createMockAccountWithBalances(testAddress, '1', {
        nativeBalance: 1,
        assets: [],
      });
      loadAccountSpy.mockResolvedValue(
        account as unknown as StellarHorizon.AccountResponse,
      );

      const result = await networkService.loadActivatedAccountOrNull(
        testAddress,
        scope,
      );

      expect(result).toBeInstanceOf(OnChainAccount);
      expect(result?.accountId).toStrictEqual(testAddress);
    });

    it('rethrows AccountLoadException when Horizon fails for other reasons', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new Error('Network error'));

      await expect(
        networkService.loadActivatedAccountOrNull(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });
  });

  describe('getAccount', () => {
    const testAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('returns OnChainAccount from RPC getAccount', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      const stellarAccount = new Account(testAddress, '5');
      getAccountSpy.mockResolvedValue(stellarAccount);

      const result = await networkService.getAccount(testAddress, scope);

      expect(result).toBeInstanceOf(OnChainAccount);
      expect(result.accountId).toStrictEqual(testAddress);
      expect(result.sequenceNumber).toBe('5');
      expect(getAccountSpy).toHaveBeenCalledWith(testAddress);
    });

    it('throws AccountNotActivatedException when RPC uses Soroban missing-account error shape', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockRejectedValue(
        new Error(`Account not found: ${testAddress}`),
      );

      await expect(
        networkService.getAccount(testAddress, scope),
      ).rejects.toThrow(AccountNotActivatedException);
    });

    it('throws AccountLoadException when error message is not the Soroban missing-account shape', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockRejectedValue(new Error('Account not found'));

      await expect(
        networkService.getAccount(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });

    it('throws AccountLoadException for other RPC errors', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockRejectedValue(new Error('RPC unavailable'));

      await expect(
        networkService.getAccount(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });
  });

  describe('getAccountOrNull', () => {
    const testAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('returns null when the account is not on-chain', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockRejectedValue(
        new Error(`Account not found: ${testAddress}`),
      );

      const result = await networkService.getAccountOrNull(testAddress, scope);
      expect(result).toBeNull();
    });

    it('returns OnChainAccount when RPC succeeds', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockResolvedValue(new Account(testAddress, '2'));

      const result = await networkService.getAccountOrNull(testAddress, scope);

      expect(result).toBeInstanceOf(OnChainAccount);
      expect(result?.sequenceNumber).toBe('2');
    });

    it('rethrows AccountLoadException for other RPC errors', async () => {
      const { getAccountSpy } = getRpcServerSpies();
      getAccountSpy.mockRejectedValue(new Error('RPC unavailable'));

      await expect(
        networkService.getAccountOrNull(testAddress, scope),
      ).rejects.toThrow(AccountLoadException);
    });
  });

  describe('getAssetData', () => {
    it('returns the matching row from getAssetsData', async () => {
      const row = {
        assetId: validSep41AssetId,
        name: 'T',
        symbol: 'TOK',
        decimals: 7,
      };
      const spy = jest
        .spyOn(NetworkService.prototype, 'getAssetsData')
        .mockResolvedValue([row]);

      const result = await networkService.getAssetData(
        validSep41AssetId,
        scope,
      );

      expect(result).toStrictEqual(row);
      expect(spy).toHaveBeenCalledWith([validSep41AssetId], scope);
      spy.mockRestore();
    });

    it('throws AssetDataFetchException when the batch omits the requested id', async () => {
      const spy = jest
        .spyOn(NetworkService.prototype, 'getAssetsData')
        .mockResolvedValue([]);

      await expect(
        networkService.getAssetData(validSep41AssetId, scope),
      ).rejects.toThrow(AssetDataFetchException);

      spy.mockRestore();
    });
  });

  describe('getAssetsData', () => {
    it('throws NetworkServiceException when getLedgerEntries fails', async () => {
      const { getLedgerEntriesSpy } = getRpcServerSpies();
      getLedgerEntriesSpy.mockRejectedValue(new Error('RPC error'));

      await expect(
        networkService.getAssetsData([validSep41AssetId], scope),
      ).rejects.toThrow(NetworkServiceException);
    });
  });

  describe('getSep41TokenBalance', () => {
    const accountAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('throws SimulationException when simulation returns an error payload', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      simulateTransactionSpy.mockResolvedValue({
        error: 'contract reverted',
      } as never);

      await expect(
        networkService.getSep41TokenBalance({
          accountAddress,
          assetId: validSep41AssetId,
          scope,
          sequenceNumber: '1',
        }),
      ).rejects.toThrow(SimulationException);
    });

    it('throws NetworkServiceException when simulation has no retval', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      simulateTransactionSpy.mockResolvedValue({
        id: 'sim-1',
        result: {},
      } as never);

      await expect(
        networkService.getSep41TokenBalance({
          accountAddress,
          assetId: validSep41AssetId,
          scope,
          sequenceNumber: '1',
        }),
      ).rejects.toThrow(NetworkServiceException);
    });

    it('returns balance from scVal when simulation succeeds', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      const retval = xdr.ScVal.scvU64(xdr.Uint64.fromString('12345'));
      simulateTransactionSpy.mockResolvedValue({
        id: 'sim-1',
        result: { retval },
      } as never);

      const result = await networkService.getSep41TokenBalance({
        accountAddress,
        assetId: validSep41AssetId,
        scope,
        sequenceNumber: '1',
      });

      expect(result.toString()).toBe('12345');
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
      expect(pollTransactionSpy).toHaveBeenCalledWith(testTransactionHash, {
        attempts: AppConfig.transaction.pollingAttempts,
      });
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
    it('returns transaction hash when pollTransaction is false', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);
      const mockTransaction = createMockTransaction();

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
      const mockTransaction = createMockTransaction();

      const result = await networkService.send({
        transaction: mockTransaction,
        scope,
        pollTransaction: true,
      });

      expect(result).toStrictEqual(testTransactionHash);
      expect(pollTransactionSpy).toHaveBeenCalledWith(testTransactionHash, {
        attempts: AppConfig.transaction.pollingAttempts,
      });
    });

    it('throws TransactionPollException when pollTransaction is true and poll fails', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);
      pollTransactionSpy.mockRejectedValue(new Error('RPC error'));
      const mockTransaction = createMockTransaction();

      await expect(
        networkService.send({
          transaction: mockTransaction,
          scope,
          pollTransaction: true,
        }),
      ).rejects.toThrow(TransactionPollException);
    });

    it('throws TransactionRetryableException when RPC returns ERROR with txBadSeq', async () => {
      const { sendTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        status: 'ERROR',
        errorResult: {
          result: jest.fn().mockReturnValue({
            switch: () => ({ name: KnownRpcError.TxBadSeq }),
          }),
        },
      } as never);
      const mockTransaction = createMockTransaction();

      await expect(
        networkService.send({ transaction: mockTransaction, scope }),
      ).rejects.toThrow(TransactionRetryableException);
    });

    it('throws TransactionSendException when RPC returns ERROR with another code', async () => {
      const { sendTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        status: 'ERROR',
        errorResult: {
          result: jest.fn().mockReturnValue({
            switch: () => ({ name: KnownRpcError.TxBadAuth }),
          }),
        },
      } as never);
      const mockTransaction = createMockTransaction();

      await expect(
        networkService.send({ transaction: mockTransaction, scope }),
      ).rejects.toThrow(TransactionSendException);
    });

    it('throws TransactionSendException when sendTransaction throws', async () => {
      const { sendTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockRejectedValue(new Error('connection reset'));
      const mockTransaction = createMockTransaction();

      await expect(
        networkService.send({ transaction: mockTransaction, scope }),
      ).rejects.toThrow(TransactionSendException);
    });
  });

  describe('simulateTransaction', () => {
    it('throws NetworkServiceException when the envelope is not a single invokeHostFunction', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();

      await expect(
        networkService.simulateTransaction(createMockTransaction(), scope),
      ).rejects.toThrow(NetworkServiceException);

      expect(simulateTransactionSpy).not.toHaveBeenCalled();
    });

    it('throws SimulationException when RPC returns a simulation error', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      simulateTransactionSpy.mockResolvedValue({
        error: 'invoke failed',
      } as never);

      await expect(
        networkService.simulateTransaction(
          createMockInvokeHostFunctionTransaction(),
          scope,
        ),
      ).rejects.toThrow(SimulationException);
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

  describe('getSep41AssetBalances', () => {
    const account = 'GDYTQGVA3NCXM5JPVMOHLDUAHMI3OQ2B2YI25BXYKROAGXXT2T3ZGHE6';
    const secondAssetId =
      'stellar:pubnet/sep41:CBGV2QFQBBGEQRUKUMCPO3SZOHDDYO6SCP5CH6TW7EALKVHCXTMWDDOF' as KnownCaip19Sep41AssetId;

    it('returns empty object when accounts is empty', async () => {
      const result = await networkService.getSep41AssetBalances({
        accounts: [],
        assetIds: [validSep41AssetId],
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(result).toStrictEqual({});
    });

    it('returns empty object when assetIds is empty', async () => {
      const result = await networkService.getSep41AssetBalances({
        accounts: [account],
        assetIds: [],
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(result).toStrictEqual({});
    });

    it('maps multicall simulation vector to per-account balances on mainnet', async () => {
      const simResultSpy = jest
        .spyOn(MultiCall.prototype, 'simResult')
        .mockResolvedValue([BigInt('100'), BigInt('200')]);

      const result = await networkService.getSep41AssetBalances({
        accounts: [account],
        assetIds: [validSep41AssetId, secondAssetId],
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(simResultSpy).toHaveBeenCalled();
      expect(result[account]?.[validSep41AssetId]?.toFixed()).toBe('100');
      expect(result[account]?.[secondAssetId]?.toFixed()).toBe('200');
      simResultSpy.mockRestore();
    });

    it('maps failed multicall cells to null', async () => {
      const simResultSpy = jest
        .spyOn(MultiCall.prototype, 'simResult')
        .mockResolvedValue([BigInt('1'), {}]);

      const result = await networkService.getSep41AssetBalances({
        accounts: [account],
        assetIds: [validSep41AssetId, secondAssetId],
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(result[account]?.[validSep41AssetId]?.toFixed()).toBe('1');
      expect(result[account]?.[secondAssetId]).toBeNull();
      simResultSpy.mockRestore();
    });

    it('returns empty object on testnet (batch SEP-41 balances not supported)', async () => {
      const simResultSpy = jest.spyOn(MultiCall.prototype, 'simResult');
      const testnetAssetId =
        'stellar:testnet/sep41:CDLZFC3SYJYDZT7K67VZ75HVSSBAXAVVD2XGDFEUCDZUFE7MDUROSPZM' as KnownCaip19Sep41AssetId;

      const result = await networkService.getSep41AssetBalances({
        accounts: [account],
        assetIds: [testnetAssetId],
        scope: KnownCaip2ChainId.Testnet,
      });

      expect(result).toStrictEqual({});
      expect(simResultSpy).not.toHaveBeenCalled();
      simResultSpy.mockRestore();
    });
  });
});
