import type { KeyringAccount } from '@metamask/keyring-api';
import { AccountCreationType } from '@metamask/keyring-api';
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk/v2';
import { InvalidParamsError } from '@metamask/snaps-sdk';
import type { JsonRpcRequest } from '@metamask/snaps-sdk';
import { create } from '@metamask/superstruct';

import {
  MultichainMethod,
  SignAuthEntryResponseStruct,
  SignMessageResponseStruct,
  SignTransactionResponseStruct,
} from './api';
import type { IKeyringRequestHandler } from './base';
import { KeyringHandler } from './keyring';
import { KnownCaip2ChainId } from '../../api';
import { METAMASK_ORIGIN } from '../../constants';
import { AccountService } from '../../services/account';
import type { StellarKeyringAccount } from '../../services/account';
import {
  generateMockStellarKeyringAccounts,
  generateStellarKeyringAccount,
} from '../../services/account/__mocks__/account.fixtures';
import { AccountNotFoundException } from '../../services/account/exceptions';
import { OnChainAccountService } from '../../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { MockAccountWithBalancesData } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import {
  createMockTransactionService,
  generateMockTransactions,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { getDerivationPath } from '../../services/wallet';
import {
  getSlip44AssetId,
  getDefaultEntropySource,
  Duration,
} from '../../utils';
import { bufferToUint8Array } from '../../utils/buffer';
import { logger } from '../../utils/logger';
import { SyncAccountsHandler } from '../cronjob/syncAccounts';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('../../utils/requestResponse', () => ({
  ...jest.requireActual('../../utils/requestResponse'),
  validateOrigin: jest.fn(),
}));
jest.mock('@metamask/keyring-snap-sdk/v2', () => ({
  handleKeyringRequest: jest.fn(),
}));

describe('KeyringHandler', () => {
  const entropySourceId = 'entropy-source-1';
  const NON_EXISTENT_ID = '00000000-0000-4000-8000-000000000000';
  let keyringHandler: KeyringHandler;
  let mockAccount: StellarKeyringAccount;
  let mockAccountId: string;
  let mockSignMessageHandler: IKeyringRequestHandler;
  let mockSignTransactionHandler: IKeyringRequestHandler;
  let mockSignAuthEntryHandler: IKeyringRequestHandler;

  const toKeyringAccount = (account: StellarKeyringAccount): KeyringAccount => {
    const { id, address, type, options, methods, scopes } = account;
    return {
      id,
      address,
      type,
      options,
      methods,
      scopes,
    };
  };

  const getAccountServiceSpies = () => ({
    listAccountsSpy: jest.spyOn(AccountService.prototype, 'listAccounts'),
    findByIdSpy: jest.spyOn(AccountService.prototype, 'findById'),
    deleteSpy: jest.spyOn(AccountService.prototype, 'delete'),
    resolveAccountSpy: jest.spyOn(AccountService.prototype, 'resolveAccount'),
    batchCreateAccountSpy: jest.spyOn(AccountService.prototype, 'batchCreate'),
    findByIdsSpy: jest.spyOn(AccountService.prototype, 'findByIds'),
  });

  const createTestOnChainAccount = (
    address: string,
    data: MockAccountWithBalancesData = DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  ): OnChainAccount => {
    const stellarAccount = createMockAccountWithBalances(address, '1', data);
    return new OnChainAccount(
      stellarAccount,
      KnownCaip2ChainId.Mainnet,
      horizonSource(stellarAccount, KnownCaip2ChainId.Mainnet),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySourceId);

    mockSignMessageHandler = { handle: jest.fn() };
    mockSignTransactionHandler = { handle: jest.fn() };
    mockSignAuthEntryHandler = { handle: jest.fn() };

    const { accountService, onChainAccountService } =
      mockOnChainAccountService();
    const { transactionService } = createMockTransactionService();
    keyringHandler = new KeyringHandler({
      logger,
      accountService,
      onChainAccountService,
      transactionService,
      handlers: {
        [MultichainMethod.SignMessage]: mockSignMessageHandler,
        [MultichainMethod.SignTransaction]: mockSignTransactionHandler,
        [MultichainMethod.SignAuthEntry]: mockSignAuthEntryHandler,
      },
    });

    mockAccount = generateMockStellarKeyringAccounts(
      1,
      entropySourceId,
    )[0] as StellarKeyringAccount;
    mockAccountId = mockAccount.id;
  });

  describe('handle', () => {
    const v2Request = {
      method: 'keyring_getAccounts',
      id: '1',
      jsonrpc: '2.0',
    } as JsonRpcRequest;

    it('routes keyring methods to the v2 dispatcher', async () => {
      jest.mocked(handleKeyringRequest).mockResolvedValue([]);

      const result = await keyringHandler.handle(METAMASK_ORIGIN, v2Request);

      expect(handleKeyringRequest).toHaveBeenCalledWith(
        keyringHandler,
        v2Request,
      );
      expect(result).toStrictEqual([]);
    });

    it('returns null if the dispatcher returns null', async () => {
      jest.mocked(handleKeyringRequest).mockResolvedValue(null);

      const result = await keyringHandler.handle(METAMASK_ORIGIN, v2Request);

      expect(result).toBeNull();
    });
  });

  describe('getAccount', () => {
    it('gets an account by its ID', async () => {
      const { findByIdSpy } = getAccountServiceSpies();
      findByIdSpy.mockResolvedValue(mockAccount);

      const result = await keyringHandler.getAccount(mockAccountId);

      expect(findByIdSpy).toHaveBeenCalledWith(mockAccountId);
      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
    });

    it('propagates errors when account retrieval fails', async () => {
      const { findByIdSpy } = getAccountServiceSpies();
      findByIdSpy.mockRejectedValue(new Error('Account retrieval failed'));

      await expect(keyringHandler.getAccount(mockAccountId)).rejects.toThrow(
        'Account retrieval failed',
      );
    });

    it('throws an error if the account ID is not a valid account ID', async () => {
      await expect(keyringHandler.getAccount('not-uuid')).rejects.toThrow(
        InvalidParamsError,
      );
    });
  });

  describe('getAccount (v2 semantics)', () => {
    it('throws for an unknown account id instead of returning undefined', async () => {
      const { findByIdSpy } = getAccountServiceSpies();
      findByIdSpy.mockResolvedValue(undefined);

      await expect(keyringHandler.getAccount(NON_EXISTENT_ID)).rejects.toThrow(
        AccountNotFoundException,
      );
    });
  });

  describe('getAccounts', () => {
    it('lists all accounts', async () => {
      const expectedAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const { listAccountsSpy } = getAccountServiceSpies();
      listAccountsSpy.mockResolvedValue(expectedAccounts);

      const result = await keyringHandler.getAccounts();

      expect(result).toStrictEqual(
        expectedAccounts.map((account) => toKeyringAccount(account)),
      );
    });

    it('propagates errors when account listing fails', async () => {
      const { listAccountsSpy } = getAccountServiceSpies();
      listAccountsSpy.mockRejectedValue(new Error('Account listing failed'));

      await expect(keyringHandler.getAccounts()).rejects.toThrow(
        'Account listing failed',
      );
    });
  });

  describe('createAccounts', () => {
    const accountsAt = (...indexes: number[]) =>
      indexes.map((index) =>
        generateStellarKeyringAccount(
          `id-${index}`,
          mockAccount.address,
          entropySourceId,
          index,
        ),
      );

    it('creates one account for bip44:derive-index', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      batchCreateAccountSpy.mockResolvedValue([mockAccount]);

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44DeriveIndex,
        entropySource: entropySourceId,
        groupIndex: 2,
      });

      expect(batchCreateAccountSpy).toHaveBeenCalledWith({
        entropySource: entropySourceId,
        fromIndex: 2,
        toIndex: 2,
      });
      expect(result).toStrictEqual([toKeyringAccount(mockAccount)]);
    });

    it('creates accounts for each index in bip44:derive-index-range', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      batchCreateAccountSpy.mockResolvedValue(accountsAt(1, 2, 3));

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44DeriveIndexRange,
        entropySource: entropySourceId,
        range: { from: 1, to: 3 },
      });

      expect(batchCreateAccountSpy).toHaveBeenCalledWith({
        entropySource: entropySourceId,
        fromIndex: 1,
        toIndex: 3,
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.options).toMatchObject({
        entropy: expect.objectContaining({ groupIndex: 1 }),
      });
      expect(result[2]?.options).toMatchObject({
        entropy: expect.objectContaining({ groupIndex: 3 }),
      });
    });

    it('propagates errors when account creation fails', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      batchCreateAccountSpy.mockRejectedValue(new Error('Batch create failed'));

      await expect(
        keyringHandler.createAccounts({
          type: AccountCreationType.Bip44DeriveIndexRange,
          entropySource: entropySourceId,
          range: { from: 0, to: 2 },
        }),
      ).rejects.toThrow('Batch create failed');
    });

    it('creates the discovered account when it is activated on chain', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValue(true);
      batchCreateAccountSpy.mockResolvedValue([mockAccount]);

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44Discover,
        entropySource: entropySourceId,
        groupIndex: 0,
      });

      expect(batchCreateAccountSpy).toHaveBeenCalledWith({
        entropySource: entropySourceId,
        fromIndex: 0,
        toIndex: 0,
      });
      expect(result).toStrictEqual([toKeyringAccount(mockAccount)]);
    });

    it('creates no account when discovery finds no on-chain activity', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValue(false);

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44Discover,
        entropySource: entropySourceId,
        groupIndex: 0,
      });

      expect(result).toStrictEqual([]);
      expect(batchCreateAccountSpy).not.toHaveBeenCalled();
    });

    it('throws when create account option type is not supported', async () => {
      await expect(
        keyringHandler.createAccounts({
          type: AccountCreationType.Bip44DerivePath,
          entropySource: entropySourceId,
          derivationPath: getDerivationPath(0),
        }),
      ).rejects.toThrow('Unsupported create account option type');
    });
  });

  describe('getAccountAssets', () => {
    it('returns on-chain asset ids for the account', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      const onChainAccount = createTestOnChainAccount(mockAccount.address);
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue(onChainAccount);

      const result = await keyringHandler.getAccountAssets(mockAccountId);

      expect(result).toStrictEqual(onChainAccount.assetIds);
    });

    it('returns native asset id when the account is not activated on-chain', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue(null);

      const result = await keyringHandler.getAccountAssets(mockAccountId);

      expect(result).toStrictEqual([slipId]);
    });

    it('propagates errors when listing assets fails for another reason', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockRejectedValue(new Error('Horizon unavailable'));

      await expect(
        keyringHandler.getAccountAssets(mockAccountId),
      ).rejects.toThrow('Horizon unavailable');
    });

    it('rejects invalid account id', async () => {
      await expect(keyringHandler.getAccountAssets('not-uuid')).rejects.toThrow(
        InvalidParamsError,
      );
    });
  });

  describe('getAccountTransactions', () => {
    it('lists the account transactions', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({
        account: mockAccount,
      });
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(10, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

      const result = await keyringHandler.getAccountTransactions(
        mockAccountId,
        {
          limit: 10,
        },
      );

      expect(result).toStrictEqual({
        data: mockTransactions,
        next: null,
      });
    });

    it('lists the account transactions with pagination', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({
        account: mockAccount,
      });
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(30, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

      const result = await keyringHandler.getAccountTransactions(
        mockAccountId,
        {
          limit: 5,
          next: mockTransactions[5]?.id,
        },
      );

      expect(result).toStrictEqual({
        data: mockTransactions.slice(5, 10),
        next: mockTransactions[10]?.id,
      });
    });

    it('throws when pagination cursor does not match any transaction', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({
        account: mockAccount,
      });
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(5, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

      await expect(
        keyringHandler.getAccountTransactions(mockAccountId, {
          limit: 2,
          next: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('getAccountBalances', () => {
    it('returns balances for assets with positive balance and metadata', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      const onChainAccount = createTestOnChainAccount(mockAccount.address, {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 2.000001,
      });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue(onChainAccount);

      const result = await keyringHandler.getAccountBalances(mockAccountId, [
        slipId,
      ]);

      expect(result).toStrictEqual({
        [slipId]: {
          unit: 'XLM',
          amount: '2.000001',
          metadata: {
            spendableBalance: '10000010',
            minimumReserveBalance: '10000000',
            decimal: 7,
          },
        },
      });
    });

    it('returns zero native balance when the account is not activated on-chain', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue(null);

      const result = await keyringHandler.getAccountBalances(mockAccountId, [
        slipId,
      ]);

      expect(result).toStrictEqual({
        [slipId]: {
          unit: 'XLM',
          amount: '0',
          metadata: {
            spendableBalance: '0',
            minimumReserveBalance: '0',
            decimal: 7,
          },
        },
      });
    });

    it('propagates errors when balance resolution fails for another reason', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockRejectedValue(new Error('Horizon unavailable'));

      await expect(
        keyringHandler.getAccountBalances(mockAccountId, [slipId]),
      ).rejects.toThrow('Horizon unavailable');
    });
  });

  describe('resolveAccountAddress', () => {
    it('resolves an account address from opts.address', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({
        account: mockAccount,
      });

      const result = await keyringHandler.resolveAccountAddress(
        KnownCaip2ChainId.Mainnet,
        {
          method: MultichainMethod.SignMessage,
          id: '1',
          jsonrpc: '2.0',
          params: {
            opts: { address: mockAccount.address },
          },
        },
      );

      expect(resolveAccountSpy).toHaveBeenCalledWith({
        scope: KnownCaip2ChainId.Mainnet,
        accountAddress: mockAccount.address,
      });
      expect(result).toStrictEqual({
        address: `${KnownCaip2ChainId.Mainnet}:${mockAccount.address}`,
      });
    });

    it('returns null when the account is not in this snap (AccountNotFoundException)', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new AccountNotFoundException(mockAccount.address),
      );

      const result = await keyringHandler.resolveAccountAddress(
        KnownCaip2ChainId.Mainnet,
        {
          method: MultichainMethod.SignMessage,
          id: '1',
          jsonrpc: '2.0',
          params: { opts: { address: mockAccount.address } },
        },
      );

      expect(result).toBeNull();
    });

    it('propagates errors when account address resolution fails for other reasons', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new Error('Account address resolution failed'),
      );

      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: MultichainMethod.SignMessage,
          id: '1',
          jsonrpc: '2.0',
          params: { opts: { address: mockAccount.address } },
        }),
      ).rejects.toThrow('Account address resolution failed');
    });

    it('throws an error if the account address resolution request is invalid', async () => {
      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: 'invalid:method',
          id: '1',
          jsonrpc: '2.0',
          params: {
            opts: { address: mockAccount.address },
          },
        }),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('deleteAccount', () => {
    it('deletes an account', async () => {
      const { deleteSpy } = getAccountServiceSpies();

      await keyringHandler.deleteAccount(mockAccountId);

      expect(deleteSpy).toHaveBeenCalledWith(mockAccountId);
    });

    it('propagates errors when account deletion fails', async () => {
      const { deleteSpy } = getAccountServiceSpies();
      deleteSpy.mockRejectedValue(new Error('Account deletion failed'));

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        'Account deletion failed',
      );
    });

    it('deletes idempotently when the account does not exist', async () => {
      const { deleteSpy } = getAccountServiceSpies();

      expect(
        await keyringHandler.deleteAccount(NON_EXISTENT_ID),
      ).toBeUndefined();

      expect(deleteSpy).toHaveBeenCalledWith(NON_EXISTENT_ID);
    });

    it('throws an error if the account deletion request is invalid', async () => {
      await expect(keyringHandler.deleteAccount('not-uuid')).rejects.toThrow(
        InvalidParamsError,
      );
    });
  });

  describe('submitRequest', () => {
    const keyringRequestId = '22222222-2222-4222-8222-222222222222';

    it('submits a sign message request', async () => {
      const expectedResult = {
        signedMessage: bufferToUint8Array(
          'Stellar Signed Message: Hello, world!',
          'utf8',
        ).toString('base64'),
        signerAddress: mockAccount.address,
      };

      jest
        .mocked(mockSignMessageHandler.handle)
        .mockResolvedValue(expectedResult);

      const signMessagePayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignMessage,
          params: {
            message: 'Hello, world!',
          },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const result = await keyringHandler.submitRequest(signMessagePayload);

      expect(mockSignMessageHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockSignMessageHandler.handle).toHaveBeenCalledWith(
        signMessagePayload,
      );
      expect(mockSignTransactionHandler.handle).not.toHaveBeenCalled();
      expect(result).toStrictEqual(expectedResult);
    });

    it('submits a sign transaction request', async () => {
      const xdr = `AAAAAgAAAADjngeX0YTNoQ15A0xC83aMm/sDnXrmLF+apmXvdmkUugAAAGQAC3gAAAAAQQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAOZfkjSFZ31vI/Nx28cC6iAFWLWcPIvJhM2NVoxmfgVTAAAAAAAAAAAAmJaAAAAAAAAAAAA=`;

      const expectedResult = {
        signedTxXdr: xdr,
        signerAddress: mockAccount.address,
      };

      jest
        .mocked(mockSignTransactionHandler.handle)
        .mockResolvedValue(expectedResult);

      const signTransactionPayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignTransaction,
          params: { xdr },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const result = await keyringHandler.submitRequest(signTransactionPayload);

      expect(mockSignTransactionHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockSignTransactionHandler.handle).toHaveBeenCalledWith(
        signTransactionPayload,
      );
      expect(mockSignMessageHandler.handle).not.toHaveBeenCalled();
      expect(mockSignAuthEntryHandler.handle).not.toHaveBeenCalled();
      expect(result).toStrictEqual(expectedResult);
    });

    it('submits a sign auth entry request', async () => {
      const authEntry = `AAAACXrDOZdUTjF10ma9AiQ5sizbFlCMARY/JuXLKj4QRal5AAAAAAdbzRUAD0JAAAAAAAAAAAECAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAAAAh0cmFuc2ZlcgAAAAAAAAAA`;

      const expectedResult = {
        signedAuthEntry: bufferToUint8Array('signed', 'utf8').toString(
          'base64',
        ),
        signerAddress: mockAccount.address,
      };

      jest
        .mocked(mockSignAuthEntryHandler.handle)
        .mockResolvedValue(expectedResult);

      const signAuthEntryPayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignAuthEntry,
          params: { authEntry },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const result = await keyringHandler.submitRequest(signAuthEntryPayload);

      expect(mockSignAuthEntryHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockSignAuthEntryHandler.handle).toHaveBeenCalledWith(
        signAuthEntryPayload,
      );
      expect(mockSignMessageHandler.handle).not.toHaveBeenCalled();
      expect(mockSignTransactionHandler.handle).not.toHaveBeenCalled();
      expect(result).toStrictEqual(expectedResult);
    });

    it('throws an error if the request is invalid', async () => {
      await expect(
        keyringHandler.submitRequest({
          id: keyringRequestId,
          origin: METAMASK_ORIGIN,
          request: {
            method: 'invalid:method',
            params: { message: 'Hello, world!' },
          },
          scope: KnownCaip2ChainId.Mainnet,
          account: mockAccountId,
        }),
      ).rejects.toThrow(InvalidParamsError);

      expect(mockSignMessageHandler.handle).not.toHaveBeenCalled();
      expect(mockSignTransactionHandler.handle).not.toHaveBeenCalled();
      expect(mockSignAuthEntryHandler.handle).not.toHaveBeenCalled();
    });

    it('exposes a submitRequest result that satisfies the SEP-43 response struct', async () => {
      const expectedWithError = {
        signedMessage: '',
        signerAddress:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        error: { message: 'x', code: -3, ext: ['y'] },
      };
      jest
        .mocked(mockSignMessageHandler.handle)
        .mockResolvedValue(expectedWithError);

      const signMessagePayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignMessage,
          params: {
            message: 'Hello, world!',
          },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const response = await keyringHandler.submitRequest(signMessagePayload);
      expect(() => create(response, SignMessageResponseStruct)).not.toThrow();
    });

    it('exposes a sign-tx submitRequest result that satisfies the SEP-43 response struct', async () => {
      const xdr = `AAAAAgAAAADjngeX0YTNoQ15A0xC83aMm/sDnXrmLF+apmXvdmkUugAAAGQAC3gAAAAAQQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAOZfkjSFZ31vI/Nx28cC6iAFWLWcPIvJhM2NVoxmfgVTAAAAAAAAAAAAmJaAAAAAAAAAAAA=`;
      const expectedWithError = {
        signedTxXdr: '',
        signerAddress: mockAccount.address,
        error: { message: 'x', code: -1 },
      };
      jest
        .mocked(mockSignTransactionHandler.handle)
        .mockResolvedValue(expectedWithError);

      const signTransactionPayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignTransaction,
          params: { xdr },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const response = await keyringHandler.submitRequest(
        signTransactionPayload,
      );
      expect(() =>
        create(response, SignTransactionResponseStruct),
      ).not.toThrow();
    });

    it('exposes a sign-auth-entry submitRequest result that satisfies the SEP-43 response struct', async () => {
      const authEntry = `AAAACXrDOZdUTjF10ma9AiQ5sizbFlCMARY/JuXLKj4QRal5AAAAAAdbzRUAD0JAAAAAAAAAAAECAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAAAAh0cmFuc2ZlcgAAAAAAAAAA`;
      const expectedWithError = {
        signedAuthEntry: '',
        signerAddress: mockAccount.address,
        error: { message: 'x', code: -3 },
      };
      jest
        .mocked(mockSignAuthEntryHandler.handle)
        .mockResolvedValue(expectedWithError);

      const signAuthEntryPayload = {
        id: keyringRequestId,
        origin: METAMASK_ORIGIN,
        request: {
          method: MultichainMethod.SignAuthEntry,
          params: { authEntry },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const response = await keyringHandler.submitRequest(signAuthEntryPayload);
      expect(() => create(response, SignAuthEntryResponseStruct)).not.toThrow();
    });
  });

  describe('setSelectedAccounts', () => {
    it('schedules a background event to synchronize the selected accounts', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      findByIdsSpy.mockResolvedValue([mockAccount]);

      const syncSpy = jest.spyOn(
        SyncAccountsHandler,
        'scheduleBackgroundEvent',
      );

      await keyringHandler.setSelectedAccounts([mockAccountId]);

      expect(findByIdsSpy).toHaveBeenCalledWith([mockAccountId]);
      expect(syncSpy).toHaveBeenCalledWith(
        {
          accountIds: [mockAccountId],
        },
        Duration.OneSecond,
      );
    });

    it('dedupes duplicate ids before lookup and before scheduling the background event', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      findByIdsSpy.mockResolvedValue([mockAccount]);

      const syncSpy = jest.spyOn(
        SyncAccountsHandler,
        'scheduleBackgroundEvent',
      );

      await keyringHandler.setSelectedAccounts([mockAccountId, mockAccountId]);

      expect(findByIdsSpy).toHaveBeenCalledWith([mockAccountId]);
      expect(syncSpy).toHaveBeenCalledWith(
        {
          accountIds: [mockAccountId],
        },
        Duration.OneSecond,
      );
    });

    it('schedules synchronization for multiple known accounts', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      const secondAccount = generateMockStellarKeyringAccounts(
        1,
        entropySourceId,
      )[0] as StellarKeyringAccount;
      findByIdsSpy.mockResolvedValue([mockAccount, secondAccount]);

      const syncSpy = jest.spyOn(
        SyncAccountsHandler,
        'scheduleBackgroundEvent',
      );

      await keyringHandler.setSelectedAccounts([
        mockAccountId,
        secondAccount.id,
      ]);

      expect(findByIdsSpy).toHaveBeenCalledWith([
        mockAccountId,
        secondAccount.id,
      ]);
      expect(syncSpy).toHaveBeenCalledWith(
        {
          accountIds: [mockAccountId, secondAccount.id],
        },
        Duration.OneSecond,
      );
    });

    it('validates empty selection against the repo but skips scheduling sync', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      findByIdsSpy.mockResolvedValue([]);

      const syncSpy = jest.spyOn(
        SyncAccountsHandler,
        'scheduleBackgroundEvent',
      );

      await keyringHandler.setSelectedAccounts([]);

      expect(findByIdsSpy).toHaveBeenCalledWith([]);
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('throws InvalidParamsError when structured params are invalid', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      await expect(
        keyringHandler.setSelectedAccounts(
          'not-an-array' as unknown as string[],
        ),
      ).rejects.toThrow(InvalidParamsError);

      await expect(
        keyringHandler.setSelectedAccounts(['invalid:account:id']),
      ).rejects.toThrow(InvalidParamsError);

      expect(findByIdsSpy).not.toHaveBeenCalled();
    });

    it('throws InvalidParamsError when a valid-looking id does not belong to this keyring', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      const unknownId = globalThis.crypto.randomUUID();
      findByIdsSpy.mockResolvedValue([]);

      await expect(
        keyringHandler.setSelectedAccounts([unknownId]),
      ).rejects.toThrow(InvalidParamsError);

      expect(findByIdsSpy).toHaveBeenCalledWith([unknownId]);
    });

    it('throws InvalidParamsError when only a subset of the ids exist', async () => {
      const { findByIdsSpy } = getAccountServiceSpies();
      const unknownId = globalThis.crypto.randomUUID();
      findByIdsSpy.mockResolvedValue([mockAccount]);

      await expect(
        keyringHandler.setSelectedAccounts([mockAccountId, unknownId]),
      ).rejects.toThrow(InvalidParamsError);

      expect(findByIdsSpy).toHaveBeenCalledWith([mockAccountId, unknownId]);
    });
  });
});
