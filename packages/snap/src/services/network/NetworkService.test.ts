import { TransactionStatus } from '@metamask/keyring-api';
import {
  Account,
  Contract,
  Horizon as StellarHorizon,
  Networks,
  nativeToScVal,
  NotFoundError,
  rpc as StellarRpc,
  SorobanDataBuilder,
  TransactionBuilder as StellarTransactionBuilder,
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
  TransactionNotFoundException,
  TransactionPollException,
  TransactionRetryableException,
  TransactionSendException,
} from './exceptions';
import { MultiCall } from './MultiCall';
import { NetworkService } from './NetworkService';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
} from '../../api';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import { logger } from '../../utils/logger';
import { InMemoryCache } from '../cache/InMemoryCache';
import { createMockAccountWithBalances } from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import {
  buildMockClassicTransaction,
  buildMockHorizonTransactionPage,
  buildMockHorizonTransactionRecord,
  buildMockInvokeHostFunctionTransaction,
} from '../transaction/__mocks__/transaction.fixtures';
import { InvalidInvokeContractStructureException } from '../transaction/exceptions';
import { Transaction } from '../transaction/Transaction';
import { generateStellarAddress } from '../wallet/__mocks__/wallet.fixtures';

jest.mock('../../utils/logger');

describe('NetworkService', () => {
  let networkService: NetworkService;

  const testTransactionHash =
    '58b5e4cd7319962ecbfbdaa7a3b9444c9117e130935da4f14a695dd5d1423d0a';
  let scope: KnownCaip2ChainId;

  beforeEach(() => {
    jest.clearAllMocks();
    networkService = new NetworkService({
      logger,
      cache: new InMemoryCache(logger),
    });
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
    return buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: accountId ?? generateStellarAddress(),
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
      },
    );
  };

  const mockHorizonAccountTransactions = (
    call: jest.Mock,
  ): jest.SpyInstance => {
    return jest
      .spyOn(StellarHorizon.Server.prototype, 'transactions')
      .mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            cursor: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                includeFailed: jest.fn().mockReturnValue({ call }),
              }),
            }),
          }),
        }),
      } as never);
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

  const buildTransactionWithTwoInvokeHostFunctionOps = (): Transaction => {
    const source = 'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';
    const stellarAccount = new Account(source, '1');
    const contract = new Contract(
      'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT',
    );
    const builder = new StellarTransactionBuilder(stellarAccount, {
      fee: '200',
      networkPassphrase: Networks.PUBLIC,
    });
    builder.addOperation(contract.call('fnA', nativeToScVal(1)));
    builder.addOperation(contract.call('fnB', nativeToScVal(2)));
    return new Transaction(builder.setTimeout(60).build());
  };

  describe('getBaseFee', () => {
    it('returns base fee as BigNumber', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockResolvedValue(100);

      const result = await networkService.getBaseFee(scope);

      expect(result).toStrictEqual(
        new BigNumber(100).multipliedBy(
          AppConfig.transaction.baseFeeMultiplier,
        ),
      );
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

  describe('getBaseFeeWithCache', () => {
    it('returns cached base fee without refetching Horizon when refreshCache is false', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockResolvedValue(55);

      const first = await networkService.getBaseFeeWithCache(scope);
      await Promise.resolve();
      await Promise.resolve();
      const second = await networkService.getBaseFeeWithCache(scope);

      expect(first).toStrictEqual(
        new BigNumber(55).multipliedBy(AppConfig.transaction.baseFeeMultiplier),
      );
      expect(second).toStrictEqual(
        new BigNumber(55).multipliedBy(AppConfig.transaction.baseFeeMultiplier),
      );
      expect(fetchBaseFeeSpy).toHaveBeenCalledTimes(1);
    });

    it('refetches base fee when refreshCache is true', async () => {
      const { fetchBaseFeeSpy } = getHorizonClientSpies();
      fetchBaseFeeSpy.mockResolvedValueOnce(10).mockResolvedValueOnce(11);

      await networkService.getBaseFeeWithCache(scope);
      await Promise.resolve();
      await Promise.resolve();
      const refreshed = await networkService.getBaseFeeWithCache(scope, true);

      expect(refreshed).toStrictEqual(
        // expected value is 11 * 1.2 = 13.2, rounded up to 14
        new BigNumber(11)
          .multipliedBy(AppConfig.transaction.baseFeeMultiplier)
          .integerValue(BigNumber.ROUND_CEIL),
      );
      expect(fetchBaseFeeSpy).toHaveBeenCalledTimes(2);
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

  describe('loadOnChainAccountWithCache', () => {
    const testAddress =
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG';

    it('returns cached account without a second Horizon load when refreshCache is false', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      const account = createMockAccountWithBalances(testAddress, '9', {
        nativeBalance: 1,
        assets: [],
      });
      loadAccountSpy.mockResolvedValue(
        account as unknown as StellarHorizon.AccountResponse,
      );

      const first = await networkService.loadOnChainAccountWithCache(
        testAddress,
        scope,
      );
      await Promise.resolve();
      await Promise.resolve();
      const second = await networkService.loadOnChainAccountWithCache(
        testAddress,
        scope,
      );

      expect(first.accountId).toStrictEqual(testAddress);
      expect(second.accountId).toStrictEqual(testAddress);
      expect(first.sequenceNumber).toBe('9');
      expect(second.sequenceNumber).toBe('9');
      expect(loadAccountSpy).toHaveBeenCalledTimes(1);
    });

    it('refetches account when refreshCache is true', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      const accountV1 = createMockAccountWithBalances(testAddress, '1', {
        nativeBalance: 1,
        assets: [],
      });
      const accountV2 = createMockAccountWithBalances(testAddress, '2', {
        nativeBalance: 1,
        assets: [],
      });
      loadAccountSpy
        .mockResolvedValueOnce(
          accountV1 as unknown as StellarHorizon.AccountResponse,
        )
        .mockResolvedValueOnce(
          accountV2 as unknown as StellarHorizon.AccountResponse,
        );

      await networkService.loadOnChainAccountWithCache(testAddress, scope);
      await Promise.resolve();
      await Promise.resolve();
      const refreshed = await networkService.loadOnChainAccountWithCache(
        testAddress,
        scope,
        true,
      );

      expect(refreshed.sequenceNumber).toBe('2');
      expect(loadAccountSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadOnChainAccounts', () => {
    const addrA = generateStellarAddress();
    const addrB = generateStellarAddress();

    it('returns empty array without calling Horizon when addresses is empty', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();

      const result = await networkService.loadOnChainAccounts([], scope);

      expect(result).toStrictEqual([]);
      expect(loadAccountSpy).not.toHaveBeenCalled();
    });

    it('returns loaded accounts in the same order as the input addresses', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy
        .mockResolvedValueOnce(
          createMockAccountWithBalances(addrA, '10', {
            nativeBalance: 1,
            assets: [],
          }) as unknown as StellarHorizon.AccountResponse,
        )
        .mockResolvedValueOnce(
          createMockAccountWithBalances(addrB, '20', {
            nativeBalance: 1,
            assets: [],
          }) as unknown as StellarHorizon.AccountResponse,
        );

      const result = await networkService.loadOnChainAccounts(
        [addrA, addrB],
        scope,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(OnChainAccount);
      expect(result[1]).toBeInstanceOf(OnChainAccount);
      expect(result[0]?.accountId).toStrictEqual(addrA);
      expect(result[0]?.sequenceNumber).toBe('10');
      expect(result[1]?.accountId).toStrictEqual(addrB);
      expect(result[1]?.sequenceNumber).toBe('20');
      expect(loadAccountSpy).toHaveBeenCalledTimes(2);
    });

    it('maps failures to null, preserves order, and logs a warning', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();
      loadAccountSpy
        .mockRejectedValueOnce(new NotFoundError('not found', {}))
        .mockResolvedValueOnce(
          createMockAccountWithBalances(addrA, '1', {
            nativeBalance: 1,
            assets: [],
          }) as unknown as StellarHorizon.AccountResponse,
        );

      const result = await networkService.loadOnChainAccounts(
        [addrB, addrA],
        scope,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeInstanceOf(OnChainAccount);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        'Failed to preload participating account',
        expect.objectContaining({
          accountId: addrB,
          error: expect.any(AccountNotActivatedException),
        }),
      );
    });

    it('throws NetworkServiceException when batchSize is less than one', async () => {
      const { loadAccountSpy } = getHorizonClientSpies();

      await expect(
        networkService.loadOnChainAccounts([addrA], scope, 0),
      ).rejects.toThrow(NetworkServiceException);

      expect(loadAccountSpy).not.toHaveBeenCalled();
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

  describe('getClassicAssetData', () => {
    const classicAssetId =
      'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as KnownCaip19ClassicAssetId;
    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

    /* eslint-disable @typescript-eslint/naming-convention -- Horizon asset record fields */
    it('returns classic asset metadata from Horizon', async () => {
      const call = jest.fn().mockResolvedValue({
        records: [
          {
            asset_code: 'USDC',
            asset_issuer: issuer,
          },
        ],
      });
      const assetsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'assets')
        .mockReturnValue({
          forCode: jest.fn().mockReturnValue({
            forIssuer: jest.fn().mockReturnValue({ call }),
          }),
        } as never);

      const result = await networkService.getClassicAssetData(
        classicAssetId,
        scope,
      );

      expect(result).toStrictEqual({
        assetId: classicAssetId,
        symbol: 'USDC',
        decimals: STELLAR_DECIMAL_PLACES,
        name: 'USDC',
      });
      expect(call).toHaveBeenCalled();
      assetsSpy.mockRestore();
    });

    it('throws AssetDataFetchException when Horizon returns no rows', async () => {
      const call = jest.fn().mockResolvedValue({ records: [] });
      const assetsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'assets')
        .mockReturnValue({
          forCode: jest.fn().mockReturnValue({
            forIssuer: jest.fn().mockReturnValue({ call }),
          }),
        } as never);

      await expect(
        networkService.getClassicAssetData(classicAssetId, scope),
      ).rejects.toThrow(AssetDataFetchException);

      assetsSpy.mockRestore();
    });

    it('throws AssetDataFetchException when the matching row issuer does not match', async () => {
      const call = jest.fn().mockResolvedValue({
        records: [
          {
            asset_code: 'USDC',
            asset_issuer:
              'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          },
        ],
      });
      const assetsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'assets')
        .mockReturnValue({
          forCode: jest.fn().mockReturnValue({
            forIssuer: jest.fn().mockReturnValue({ call }),
          }),
        } as never);

      await expect(
        networkService.getClassicAssetData(classicAssetId, scope),
      ).rejects.toThrow(AssetDataFetchException);

      assetsSpy.mockRestore();
    });

    it('wraps unexpected Horizon errors in NetworkServiceException', async () => {
      const call = jest.fn().mockRejectedValue(new Error('Horizon outage'));
      const assetsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'assets')
        .mockReturnValue({
          forCode: jest.fn().mockReturnValue({
            forIssuer: jest.fn().mockReturnValue({ call }),
          }),
        } as never);

      await expect(
        networkService.getClassicAssetData(classicAssetId, scope),
      ).rejects.toThrow(NetworkServiceException);

      assetsSpy.mockRestore();
    });
    /* eslint-enable @typescript-eslint/naming-convention */
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
      ).rejects.toMatchObject({
        transactionHash: testTransactionHash,
        status: StellarRpc.Api.GetTransactionStatus.FAILED,
        scope,
      });
    });

    it('throws TransactionPollException when poll fails', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      pollTransactionSpy.mockRejectedValue(new Error('RPC error'));

      await expect(
        networkService.pollTransaction(testTransactionHash, scope),
      ).rejects.toMatchObject({
        transactionHash: testTransactionHash,
        status: 'unknown',
        scope,
      });
    });

    it('rethrows TransactionPollException when poll rejects with one', async () => {
      const { pollTransactionSpy } = getRpcServerSpies();
      const pollException = new TransactionPollException(
        testTransactionHash,
        StellarRpc.Api.GetTransactionStatus.FAILED,
        scope,
      );
      pollTransactionSpy.mockRejectedValue(pollException);

      await expect(
        networkService.pollTransaction(testTransactionHash, scope),
      ).rejects.toStrictEqual(pollException);
    });
  });

  describe('getHorizonTransactionInclusionStatus', () => {
    it('returns pending when Horizon returns NotFoundError', async () => {
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({
            call: jest
              .fn()
              .mockRejectedValue(new NotFoundError('not found', {})),
          }),
        } as never);

      const result = await networkService.getHorizonTransactionInclusionStatus(
        testTransactionHash,
        scope,
      );

      expect(result).toBe('pending');
      transactionsSpy.mockRestore();
    });

    it('returns success when Horizon record is successful', async () => {
      const call = jest.fn().mockResolvedValue({ successful: true });
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({ call }),
        } as never);

      const result = await networkService.getHorizonTransactionInclusionStatus(
        testTransactionHash,
        scope,
      );

      expect(result).toBe('success');
      expect(call).toHaveBeenCalledTimes(1);
      transactionsSpy.mockRestore();
    });

    it('returns failed when Horizon record is not successful', async () => {
      const call = jest.fn().mockResolvedValue({ successful: false });
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({ call }),
        } as never);

      const result = await networkService.getHorizonTransactionInclusionStatus(
        testTransactionHash,
        scope,
      );

      expect(result).toBe('failed');
      transactionsSpy.mockRestore();
    });

    it('rethrows when Horizon responds with a non-404 error', async () => {
      const call = jest.fn().mockRejectedValue(new Error('timeout'));
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({ call }),
        } as never);

      await expect(
        networkService.getHorizonTransactionInclusionStatus(
          testTransactionHash,
          scope,
        ),
      ).rejects.toThrow('timeout');

      transactionsSpy.mockRestore();
    });
  });

  describe('getTransaction', () => {
    it('returns mapped transaction from Horizon record', async () => {
      const tx = createMockTransaction();
      const horizonRecord = buildMockHorizonTransactionRecord({
        transaction: tx,
        feeCharged: '321',
      });
      const call = jest.fn().mockResolvedValue(horizonRecord);
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({ call }),
        } as never);

      const result = await networkService.getTransaction(tx.id, scope);

      expect(result).toBeInstanceOf(Transaction);
      expect(result.id).toBe(tx.id);
      expect(result.feeCharged.toFixed(0)).toBe('321');
      expect(result.status).toBe(TransactionStatus.Confirmed);
      transactionsSpy.mockRestore();
    });

    it('throws TransactionNotFoundException when record is not found', async () => {
      const call = jest
        .fn()
        .mockRejectedValue(new NotFoundError('not found', {}));
      const transactionsSpy = jest
        .spyOn(StellarHorizon.Server.prototype, 'transactions')
        .mockReturnValue({
          transaction: jest.fn().mockReturnValue({ call }),
        } as never);

      await expect(
        networkService.getTransaction(testTransactionHash, scope),
      ).rejects.toThrow(TransactionNotFoundException);

      transactionsSpy.mockRestore();
    });
  });

  describe('getTransactions', () => {
    it('returns only source-account transactions when includeSelfTransactionsOnly is true', async () => {
      const accountAddress = generateStellarAddress();
      const txA = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              destination: generateStellarAddress(),
              asset: 'native',
              amount: '1',
            },
          },
        ],
        {
          networkPassphrase: Networks.PUBLIC,
          source: { accountId: accountAddress, sequence: '1' },
        },
      );
      const txBSource = generateStellarAddress();
      const txB = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              destination: generateStellarAddress(),
              asset: 'native',
              amount: '1',
            },
          },
        ],
        {
          networkPassphrase: Networks.PUBLIC,
          source: { accountId: txBSource, sequence: '1' },
        },
      );
      const records = [
        buildMockHorizonTransactionRecord({
          transaction: txA,
          sourceAccount: accountAddress,
          pagingToken: '11',
        }),
        buildMockHorizonTransactionRecord({
          transaction: txB,
          sourceAccount: txBSource,
          pagingToken: '22',
        }),
      ];
      const call = jest
        .fn()
        .mockResolvedValue(buildMockHorizonTransactionPage(records));
      const transactionsSpy = mockHorizonAccountTransactions(call);

      const result = await networkService.getTransactions({
        accountAddress,
        lastScanToken: '',
        scope,
        order: 'asc',
        includeSelfTransactionsOnly: true,
        pageSize: 10,
        maxScan: 1,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]?.sourceAccount).toBe(accountAddress);
      expect(result.nextScanToken).toBe('22');
      transactionsSpy.mockRestore();
    });

    it('returns all account records when includeSelfTransactionsOnly is false', async () => {
      const accountAddress = generateStellarAddress();
      const txA = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              destination: generateStellarAddress(),
              asset: 'native',
              amount: '1',
            },
          },
        ],
        {
          networkPassphrase: Networks.PUBLIC,
          source: { accountId: accountAddress, sequence: '1' },
        },
      );
      const txBSource = generateStellarAddress();
      const txB = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              destination: generateStellarAddress(),
              asset: 'native',
              amount: '1',
            },
          },
        ],
        {
          networkPassphrase: Networks.PUBLIC,
          source: { accountId: txBSource, sequence: '1' },
        },
      );
      const records = [
        buildMockHorizonTransactionRecord({
          transaction: txA,
          sourceAccount: accountAddress,
          pagingToken: '33',
        }),
        buildMockHorizonTransactionRecord({
          transaction: txB,
          sourceAccount: txBSource,
          pagingToken: '44',
        }),
      ];
      const call = jest
        .fn()
        .mockResolvedValue(buildMockHorizonTransactionPage(records));
      const transactionsSpy = mockHorizonAccountTransactions(call);

      const result = await networkService.getTransactions({
        accountAddress,
        lastScanToken: '',
        scope,
        order: 'desc',
        includeSelfTransactionsOnly: false,
        pageSize: 10,
        maxScan: 1,
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.nextScanToken).toBe('44');
      transactionsSpy.mockRestore();
    });

    it('returns transactions from up to maxScan pages in one call', async () => {
      const accountAddress = generateStellarAddress();
      const txA = createMockTransaction(accountAddress);
      const txB = createMockTransaction(accountAddress);
      const txC = createMockTransaction(accountAddress);

      const page1Records = [
        buildMockHorizonTransactionRecord({
          transaction: txA,
          pagingToken: '11',
        }),
      ];
      const page2Records = [
        buildMockHorizonTransactionRecord({
          transaction: txB,
          pagingToken: '22',
        }),
      ];
      const page3Records = [
        buildMockHorizonTransactionRecord({
          transaction: txC,
          pagingToken: '33',
        }),
      ];

      const page3Next = jest
        .fn()
        .mockResolvedValue(buildMockHorizonTransactionPage([]));
      const page3 = buildMockHorizonTransactionPage(page3Records, page3Next);
      const page2Next = jest.fn().mockResolvedValue(page3);
      const page2 = buildMockHorizonTransactionPage(page2Records, page2Next);
      const page1Next = jest.fn().mockResolvedValue(page2);
      const page1 = buildMockHorizonTransactionPage(page1Records, page1Next);

      const call = jest.fn().mockResolvedValue(page1);
      const transactionsSpy = mockHorizonAccountTransactions(call);

      const result = await networkService.getTransactions({
        accountAddress,
        lastScanToken: '',
        scope,
        order: 'asc',
        includeSelfTransactionsOnly: false,
        pageSize: 1,
        maxScan: 3,
      });

      expect(result.transactions).toHaveLength(3);
      expect(
        result.transactions.map((transaction) => transaction.id),
      ).toStrictEqual([txA.id, txB.id, txC.id]);
      expect(result.nextScanToken).toBe('33');
      expect(page1Next).toHaveBeenCalledTimes(1);
      expect(page2Next).toHaveBeenCalledTimes(1);
      expect(page3Next).not.toHaveBeenCalled();
      transactionsSpy.mockRestore();
    });

    it('keeps lastScanToken as nextScanToken when the first page has no records', async () => {
      const accountAddress = generateStellarAddress();
      const lastScanToken = 'cursor-abc';
      const call = jest
        .fn()
        .mockResolvedValue(buildMockHorizonTransactionPage([]));
      const transactionsSpy = mockHorizonAccountTransactions(call);

      const result = await networkService.getTransactions({
        accountAddress,
        lastScanToken,
        scope,
        order: 'asc',
        maxScan: 1,
      });

      expect(result.transactions).toHaveLength(0);
      expect(result.nextScanToken).toBe(lastScanToken);
      transactionsSpy.mockRestore();
    });

    it('fetches one page when maxScan is zero', async () => {
      const accountAddress = generateStellarAddress();
      const tx = createMockTransaction(accountAddress);
      const records = [
        buildMockHorizonTransactionRecord({
          transaction: tx,
          sourceAccount: accountAddress,
          pagingToken: '55',
        }),
      ];
      const call = jest
        .fn()
        .mockResolvedValue(buildMockHorizonTransactionPage(records));
      const transactionsSpy = mockHorizonAccountTransactions(call);

      const result = await networkService.getTransactions({
        accountAddress,
        lastScanToken: '',
        scope,
        order: 'asc',
        pageSize: 10,
        maxScan: 0,
      });

      expect(call).toHaveBeenCalledTimes(1);
      expect(result.transactions).toHaveLength(1);
      expect(result.nextScanToken).toBe('55');
      transactionsSpy.mockRestore();
    });

    it('throws NetworkServiceException when Horizon page fetch fails', async () => {
      const call = jest.fn().mockRejectedValue(new Error('Horizon error'));
      const transactionsSpy = mockHorizonAccountTransactions(call);

      await expect(
        networkService.getTransactions({
          accountAddress: generateStellarAddress(),
          lastScanToken: '',
          scope,
          order: 'asc',
        }),
      ).rejects.toThrow(NetworkServiceException);

      transactionsSpy.mockRestore();
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

    it('throws TransactionPollException when pollTransaction is true and poll returns a non-success terminal status', async () => {
      const { sendTransactionSpy, pollTransactionSpy } = getRpcServerSpies();
      sendTransactionSpy.mockResolvedValue({
        hash: testTransactionHash,
      } as unknown as StellarRpc.Api.SendTransactionResponse);
      pollTransactionSpy.mockResolvedValue({
        status: StellarRpc.Api.GetTransactionStatus.FAILED,
        txHash: testTransactionHash,
      } as unknown as StellarRpc.Api.GetFailedTransactionResponse);
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

    it('rethrows NetworkServiceException when sendTransaction throws one', async () => {
      const { sendTransactionSpy } = getRpcServerSpies();
      const networkEx = new NetworkServiceException('upstream');
      sendTransactionSpy.mockRejectedValue(networkEx);
      const mockTransaction = createMockTransaction();

      await expect(
        networkService.send({ transaction: mockTransaction, scope }),
      ).rejects.toStrictEqual(networkEx);
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

    it('throws SimulationException when simulateTransaction RPC rejects', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      simulateTransactionSpy.mockRejectedValue(new Error('RPC down'));

      await expect(
        networkService.simulateTransaction(
          createMockInvokeHostFunctionTransaction(),
          scope,
        ),
      ).rejects.toThrow(SimulationException);
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

    it('throws SimulationException with stringified error when simulation error payload is not a string', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      const isSimErrorSpy = jest
        .spyOn(StellarRpc.Api, 'isSimulationError')
        .mockReturnValue(true);
      simulateTransactionSpy.mockResolvedValue({
        error: { code: 'contract_error' },
      } as never);

      await expect(
        networkService.simulateTransaction(
          createMockInvokeHostFunctionTransaction(),
          scope,
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/"code":"contract_error"/u),
      });

      isSimErrorSpy.mockRestore();
    });

    it('applies simulationFeeMultiplier to minResourceFee before assembling', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      const mockInvoke = createMockInvokeHostFunctionTransaction();
      const minResourceFee = '1000';
      const transactionData = new SorobanDataBuilder();
      const setResourceFeeSpy = jest.spyOn(transactionData, 'setResourceFee');
      simulateTransactionSpy.mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        _parsed: true,
        id: '1',
        latestLedger: 1,
        events: [],
        minResourceFee,
        transactionData,
        result: { auth: [] },
      } as never);

      const result = await networkService.simulateTransaction(
        mockInvoke,
        scope,
      );

      expect(result).toBeInstanceOf(Transaction);
      expect(setResourceFeeSpy).toHaveBeenCalledWith(
        new BigNumber(minResourceFee)
          .multipliedBy(AppConfig.transaction.simulationFeeMultiplier)
          .toString(),
      );
    });

    it('calls RPC simulateTransaction with the wrapped envelope getRaw()', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      const mockInvoke = createMockInvokeHostFunctionTransaction();
      simulateTransactionSpy.mockRejectedValue(
        new Error('stop after simulate'),
      );

      await expect(
        networkService.simulateTransaction(mockInvoke, scope),
      ).rejects.toThrow(SimulationException);

      expect(simulateTransactionSpy).toHaveBeenCalledTimes(1);
      expect(simulateTransactionSpy).toHaveBeenCalledWith(mockInvoke.getRaw());
    });

    it('throws SimulationException when the envelope has more than one invokeHostFunction operation', async () => {
      const { simulateTransactionSpy } = getRpcServerSpies();
      const invalidStructureTx = buildTransactionWithTwoInvokeHostFunctionOps();

      await expect(
        networkService.simulateTransaction(invalidStructureTx, scope),
      ).rejects.toThrow(SimulationException);

      expect(simulateTransactionSpy).not.toHaveBeenCalled();
    });
  });

  describe('simulateSep41TransferWithCache', () => {
    it('throws NetworkServiceException when transaction is not invokeHostFunction', async () => {
      const mockTx = createMockTransaction();

      await expect(
        networkService.simulateSep41TransferWithCache({
          transaction: mockTx,
          scope,
          assetId: validSep41AssetId,
          fromAccountId: generateStellarAddress(),
          toAccountId: generateStellarAddress(),
        }),
      ).rejects.toThrow(NetworkServiceException);
    });

    it('throws InvalidInvokeContractStructureException when the envelope has multiple invokeHostFunction operations', async () => {
      const invalidStructureTx = buildTransactionWithTwoInvokeHostFunctionOps();

      await expect(
        networkService.simulateSep41TransferWithCache({
          transaction: invalidStructureTx,
          scope,
          assetId: validSep41AssetId,
          fromAccountId: generateStellarAddress(),
          toAccountId: generateStellarAddress(),
        }),
      ).rejects.toThrow(InvalidInvokeContractStructureException);
    });

    it('uses cache so simulateTransaction runs once for identical transfer context', async () => {
      const mockInvoke = createMockInvokeHostFunctionTransaction();
      const simulateTxSpy = jest
        .spyOn(NetworkService.prototype, 'simulateTransaction')
        .mockResolvedValue(mockInvoke);
      const fromAccountId = generateStellarAddress();
      const toAccountId = generateStellarAddress();

      const first = await networkService.simulateSep41TransferWithCache({
        transaction: mockInvoke,
        scope,
        assetId: validSep41AssetId,
        fromAccountId,
        toAccountId,
      });
      await Promise.resolve();
      await Promise.resolve();
      const second = await networkService.simulateSep41TransferWithCache({
        transaction: mockInvoke,
        scope,
        assetId: validSep41AssetId,
        fromAccountId,
        toAccountId,
      });

      expect(simulateTxSpy).toHaveBeenCalledTimes(1);
      expect(first.getRaw().toXDR()).toBe(second.getRaw().toXDR());
      simulateTxSpy.mockRestore();
    });

    it('runs simulateTransaction again when refreshCache is true', async () => {
      const mockInvoke = createMockInvokeHostFunctionTransaction();
      const simulateTxSpy = jest
        .spyOn(NetworkService.prototype, 'simulateTransaction')
        .mockResolvedValue(mockInvoke);
      const fromAccountId = generateStellarAddress();
      const toAccountId = generateStellarAddress();
      const params = {
        transaction: mockInvoke,
        scope,
        assetId: validSep41AssetId,
        fromAccountId,
        toAccountId,
      };

      await networkService.simulateSep41TransferWithCache(params);
      await Promise.resolve();
      await Promise.resolve();
      await networkService.simulateSep41TransferWithCache({
        ...params,
        refreshCache: true,
      });

      expect(simulateTxSpy).toHaveBeenCalledTimes(2);
      simulateTxSpy.mockRestore();
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

    it('throws NetworkServiceException when multicall result length does not match expected grid size', async () => {
      const simResultSpy = jest
        .spyOn(MultiCall.prototype, 'simResult')
        .mockResolvedValue([BigInt('1')]);

      await expect(
        networkService.getSep41AssetBalances({
          accounts: [account],
          assetIds: [validSep41AssetId, secondAssetId],
          scope: KnownCaip2ChainId.Mainnet,
        }),
      ).rejects.toThrow(NetworkServiceException);

      simResultSpy.mockRestore();
    });

    it('throws NetworkServiceException when multicall simulation throws', async () => {
      const simResultSpy = jest
        .spyOn(MultiCall.prototype, 'simResult')
        .mockRejectedValue(new Error('simulation failed'));

      await expect(
        networkService.getSep41AssetBalances({
          accounts: [account],
          assetIds: [validSep41AssetId],
          scope: KnownCaip2ChainId.Mainnet,
        }),
      ).rejects.toThrow(NetworkServiceException);

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

  describe('getSep41AssetBalancesWithCache', () => {
    const account = 'GDYTQGVA3NCXM5JPVMOHLDUAHMI3OQ2B2YI25BXYKROAGXXT2T3ZGHE6';

    it('returns cached balances without a second multicall when invoked twice with the same params', async () => {
      const simResultSpy = jest
        .spyOn(MultiCall.prototype, 'simResult')
        .mockResolvedValue([BigInt('42')]);
      const params = {
        accounts: [account],
        assetIds: [validSep41AssetId],
        scope: KnownCaip2ChainId.Mainnet,
      };

      const first = await networkService.getSep41AssetBalancesWithCache(params);
      await Promise.resolve();
      await Promise.resolve();
      const second =
        await networkService.getSep41AssetBalancesWithCache(params);

      expect(first).toStrictEqual(second);
      expect(first[account]?.[validSep41AssetId]?.toFixed()).toBe('42');
      expect(simResultSpy).toHaveBeenCalledTimes(1);
      simResultSpy.mockRestore();
    });
  });
});
