import type { EntropySourceId, KeyringAccount } from '@metamask/keyring-api';
import {
  DiscoveredAccountType,
  KeyringEvent,
  KeyringRpcMethod,
} from '@metamask/keyring-api';
import {
  emitSnapKeyringEvent,
  handleKeyringRequest,
} from '@metamask/keyring-snap-sdk';
import { InvalidParamsError, type JsonRpcRequest } from '@metamask/snaps-sdk';
import { create } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import {
  MultichainMethod,
  SignMessageResponseStruct,
  SignTransactionResponseStruct,
} from './api';
import type { IKeyringRequestHandler } from './base';
import {
  KeyringCreateAccountException,
  KeyringDeleteAccountException,
  KeyringDiscoverAccountsException,
  KeyringGetAccountBalancesException,
  KeyringGetAccountException,
  KeyringListAccountAssetsException,
  KeyringListAccountsException,
  KeyringListAccountTransactionsException,
  KeyringResolveAccountAddressException,
} from './exceptions';
import { KeyringHandler } from './keyring';
import { KnownCaip2ChainId } from '../../api';
import { KEYRING_ACCOUNT_TYPE } from '../../constants';
import {
  AccountService,
  type StellarKeyringAccount,
} from '../../services/account';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/account.fixtures';
import { AccountNotFoundException } from '../../services/account/exceptions';
import { createMockAssetMetadataService } from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { OnChainAccountService } from '../../services/on-chain-account';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import {
  createMockTransactionService,
  generateMockTransactions,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import {
  getSlip44AssetId,
  getDefaultEntropySource,
  getSnapProvider,
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
jest.mock('@metamask/keyring-snap-sdk', () => ({
  handleKeyringRequest: jest.fn(),
  emitSnapKeyringEvent: jest.fn(),
}));

describe('KeyringHandler', () => {
  const entropySourceId = 'entropy-source-1';
  let keyringHandler: KeyringHandler;
  let mockAccount: StellarKeyringAccount;
  let mockAccountId: string;
  let mockSignMessageHandler: IKeyringRequestHandler;
  let mockSignTransactionHandler: IKeyringRequestHandler;

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
    createAccountSpy: jest.spyOn(AccountService.prototype, 'create'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySourceId);

    mockSignMessageHandler = { handle: jest.fn() };
    mockSignTransactionHandler = { handle: jest.fn() };

    const { accountService, onChainAccountService } =
      mockOnChainAccountService();
    const { transactionService } = createMockTransactionService();
    const { service: assetMetadataService } = createMockAssetMetadataService();
    keyringHandler = new KeyringHandler({
      logger,
      accountService,
      onChainAccountService,
      transactionService,
      assetMetadataService,
      handlers: {
        [MultichainMethod.SignMessage]: mockSignMessageHandler,
        [MultichainMethod.SignTransaction]: mockSignTransactionHandler,
      },
    });

    mockAccount = generateMockStellarKeyringAccounts(
      1,
      entropySourceId,
    )[0] as StellarKeyringAccount;
    mockAccountId = mockAccount.id;
  });

  describe('handle', () => {
    const request = {
      method: KeyringRpcMethod.ListAccounts,
      id: '1',
      jsonrpc: '2.0',
    } as JsonRpcRequest;

    it('calls handleKeyringRequest', async () => {
      const handleKeyringRequestSpy = jest.mocked(handleKeyringRequest);
      handleKeyringRequestSpy.mockResolvedValue([]);

      const result = await keyringHandler.handle('metamask', request);

      expect(handleKeyringRequestSpy).toHaveBeenCalledWith(
        keyringHandler,
        request,
      );
      expect(result).toStrictEqual([]);
    });

    it('returns null if handleKeyringRequest returns null', async () => {
      const handleKeyringRequestSpy = jest.mocked(handleKeyringRequest);
      handleKeyringRequestSpy.mockResolvedValue(null);

      const result = await keyringHandler.handle('metamask', request);

      expect(handleKeyringRequestSpy).toHaveBeenCalledWith(
        keyringHandler,
        request,
      );
      expect(result).toBeNull();
    });
  });

  describe('listAccounts', () => {
    it('lists all accounts', async () => {
      const expectedAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      jest
        .spyOn(AccountService.prototype, 'listAccounts')
        .mockResolvedValue(expectedAccounts);

      const result = await keyringHandler.listAccounts();

      expect(result).toStrictEqual(
        expectedAccounts.map((account) => toKeyringAccount(account)),
      );
    });

    it('throws an error if the account listing fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'listAccounts')
        .mockRejectedValue(new Error('Account listing failed'));

      await expect(keyringHandler.listAccounts()).rejects.toThrow(
        KeyringListAccountsException,
      );
    });
  });

  describe('getAccount', () => {
    it('gets an account by its ID', async () => {
      jest
        .spyOn(AccountService.prototype, 'findById')
        .mockResolvedValue(mockAccount);

      const result = await keyringHandler.getAccount(mockAccountId);
      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
    });

    it('returns undefined if the account is not found', async () => {
      jest
        .spyOn(AccountService.prototype, 'findById')
        .mockResolvedValue(undefined);

      const result = await keyringHandler.getAccount(mockAccountId);

      expect(result).toBeUndefined();
    });

    it('throws an error if the account retrieval fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'findById')
        .mockRejectedValue(new Error('Account retrieval failed'));

      await expect(keyringHandler.getAccount(mockAccountId)).rejects.toThrow(
        KeyringGetAccountException,
      );
    });

    it('throws an error if the account ID is not a valid account ID', async () => {
      await expect(keyringHandler.getAccount('not-uuid')).rejects.toThrow(
        InvalidParamsError,
      );
    });
  });

  describe('createAccount', () => {
    it('creates an account', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockAccount);

      const result = await keyringHandler.createAccount();

      expect(createAccountSpy).toHaveBeenCalledTimes(1);
      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
    });

    it('emits the account-created event', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockImplementation(
        async (
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          options?: {
            entropySource?: EntropySourceId;
            index?: number;
          },
          callback?: (account: StellarKeyringAccount) => Promise<void>,
        ) => {
          // eslint-disable-next-line jest/no-conditional-in-test
          if (callback) {
            await callback(mockAccount);
          }
          return mockAccount;
        },
      );
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await keyringHandler.createAccount({
        metamask: {
          correlationId: '123',
        },
      });

      expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
        getSnapProvider(),
        KeyringEvent.AccountCreated,
        expect.objectContaining({
          account: toKeyringAccount(mockAccount),
          displayConfirmation: false,
          metamask: { correlationId: '123' },
        }),
      );
    });

    it('throws an error if the account creation fails', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockRejectedValue(new Error('Account creation failed'));

      await expect(keyringHandler.createAccount()).rejects.toThrow(
        KeyringCreateAccountException,
      );
    });
  });

  describe('listAccountAssets', () => {
    it('returns on-chain asset ids for the account', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue({
          assetIds: [slipId],
        } as unknown as OnChainAccount);

      const result = await keyringHandler.listAccountAssets(mockAccountId);

      expect(result).toStrictEqual([slipId]);
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

      const result = await keyringHandler.listAccountAssets(mockAccountId);

      expect(result).toStrictEqual([slipId]);
    });

    it('throws when listing assets fails for another reason', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockRejectedValue(new Error('Horizon unavailable'));

      await expect(
        keyringHandler.listAccountAssets(mockAccountId),
      ).rejects.toThrow(KeyringListAccountAssetsException);
    });

    it('rejects invalid account id', async () => {
      await expect(
        keyringHandler.listAccountAssets('not-uuid'),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('listAccountTransactions', () => {
    it('lists the account transactions', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({
        account: mockAccount,
      });
      const { transactionServiceFindByAccountsSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(10, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountsSpy.mockResolvedValue(mockTransactions);

      const result = await keyringHandler.listAccountTransactions(
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
      const { transactionServiceFindByAccountsSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(30, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountsSpy.mockResolvedValue(mockTransactions);

      const result = await keyringHandler.listAccountTransactions(
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
      const { transactionServiceFindByAccountsSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(5, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountsSpy.mockResolvedValue(mockTransactions);

      await expect(
        keyringHandler.listAccountTransactions(mockAccountId, {
          limit: 2,
          next: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(KeyringListAccountTransactionsException);
    });
  });

  describe('discoverAccounts', () => {
    it('discovers an account', async () => {
      const deriveKeyringAccountSpy = jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      const isAccountActivatedSpy = jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValue(true);

      const result = await keyringHandler.discoverAccounts(
        [KnownCaip2ChainId.Mainnet],
        'entropy-source-1',
        0,
      );

      expect(deriveKeyringAccountSpy).toHaveBeenCalledWith({
        entropySource: 'entropy-source-1',
        index: 0,
      });
      expect(isAccountActivatedSpy).toHaveBeenCalledWith({
        accountAddress: mockAccount.address,
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(result).toStrictEqual([
        {
          type: DiscoveredAccountType.Bip44,
          scopes: [KnownCaip2ChainId.Mainnet],
          derivationPath: mockAccount.derivationPath,
        },
      ]);
    });

    it('returns empty array if the account is not activated on the Stellar network', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValue(false);

      const result = await keyringHandler.discoverAccounts(
        [KnownCaip2ChainId.Mainnet],
        'entropy-source-1',
        0,
      );

      expect(result).toStrictEqual([]);
    });

    it('throws an error if the account discovery fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockRejectedValue(new Error('Account discovery failed'));

      await expect(
        keyringHandler.discoverAccounts(
          [KnownCaip2ChainId.Mainnet],
          'entropy-source-1',
          0,
        ),
      ).rejects.toThrow(KeyringDiscoverAccountsException);
    });

    it('throws an error if the account discovery request is invalid', async () => {
      await expect(
        keyringHandler.discoverAccounts(
          ['invalid:chain' as KnownCaip2ChainId],
          'entropy-source-1',
          0,
        ),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('getAccountBalances', () => {
    it('returns balances for assets with positive balance and metadata', async () => {
      const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .spyOn(
          OnChainAccountService.prototype,
          'resolveOnChainAccountByKeyringAccountId',
        )
        .mockResolvedValue({
          assetIds: [slipId],
          getAsset: () => ({
            balance: new BigNumber('10'),
            symbol: 'XLM',
          }),
        } as unknown as OnChainAccount);

      const result = await keyringHandler.getAccountBalances(mockAccountId, [
        slipId,
      ]);

      expect(result).toStrictEqual({
        [slipId]: { unit: 'XLM', amount: '0.000001' },
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
        [slipId]: { unit: 'XLM', amount: '0' },
      });
    });

    it('throws when balance resolution fails for another reason', async () => {
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
      ).rejects.toThrow(KeyringGetAccountBalancesException);
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

    it('throws an error if the account address resolution fails for other reasons', async () => {
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
      ).rejects.toThrow(KeyringResolveAccountAddressException);
    });

    it('throws an error if the account address resolution request is invalid', async () => {
      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: 'invalid:method' as MultichainMethod,
          id: '1',
          jsonrpc: '2.0',
          params: {
            opts: { address: mockAccount.address },
          },
        }),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('filterAccountChains', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.filterAccountChains('1', [KnownCaip2ChainId.Mainnet]),
      ).rejects.toThrow('Method not implemented. - filterAccountChains');
    });
  });

  describe('updateAccount', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.updateAccount({
          type: KEYRING_ACCOUNT_TYPE,
          id: '1',
          address: '1',
          scopes: [KnownCaip2ChainId.Mainnet],
          options: {},
          methods: [],
        }),
      ).rejects.toThrow('Method not implemented. - updateAccount');
    });
  });

  describe('deleteAccount', () => {
    it('deletes an account', async () => {
      const { deleteSpy, resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await keyringHandler.deleteAccount(mockAccountId);

      expect(deleteSpy).toHaveBeenCalledWith(mockAccountId);
      expect(resolveAccountSpy).toHaveBeenCalledWith({
        accountId: mockAccountId,
      });
      expect(deleteSpy.mock.invocationCallOrder).toHaveLength(1);
      expect(emitSnapKeyringEventSpy.mock.invocationCallOrder).toHaveLength(1);
      expect(
        Number(emitSnapKeyringEventSpy.mock.invocationCallOrder[0]),
      ).toBeLessThan(Number(deleteSpy.mock.invocationCallOrder[0]));
      expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
        getSnapProvider(),
        KeyringEvent.AccountDeleted,
        {
          id: mockAccountId,
        },
      );
    });

    it('throws an error if the account deletion fails', async () => {
      const { deleteSpy, resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      deleteSpy.mockRejectedValue(new Error('Account deletion failed'));
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        KeyringDeleteAccountException,
      );
    });

    it('throws an error if the account to delete is not found', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new AccountNotFoundException(mockAccountId),
      );
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        KeyringDeleteAccountException,
      );
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
        origin: 'metamask',
        request: {
          method: MultichainMethod.SignMessage,
          params: {
            message: bufferToUint8Array('Hello, world!', 'utf8').toString(
              'base64',
            ),
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
      expect(result).toStrictEqual({
        pending: false,
        result: expectedResult,
      });
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
        origin: 'metamask',
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
      expect(result).toStrictEqual({
        pending: false,
        result: expectedResult,
      });
    });

    it('throws an error if the request is invalid', async () => {
      await expect(
        keyringHandler.submitRequest({
          id: keyringRequestId,
          origin: 'metamask',
          request: {
            method: 'invalid:method' as MultichainMethod,
            params: { message: 'Hello, world!' },
          },
          scope: KnownCaip2ChainId.Mainnet,
          account: mockAccountId,
        }),
      ).rejects.toThrow(InvalidParamsError);

      expect(mockSignMessageHandler.handle).not.toHaveBeenCalled();
      expect(mockSignTransactionHandler.handle).not.toHaveBeenCalled();
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
        origin: 'metamask',
        request: {
          method: MultichainMethod.SignMessage,
          params: {
            message: bufferToUint8Array('Hello, world!', 'utf8').toString(
              'base64',
            ),
          },
        },
        scope: KnownCaip2ChainId.Mainnet,
        account: mockAccountId,
      };

      const response = await keyringHandler.submitRequest(signMessagePayload);
      expect(response).toMatchObject({ pending: false });
      expect(() =>
        create(
          (response as { pending: false; result: Json }).result,
          SignMessageResponseStruct,
        ),
      ).not.toThrow();
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
        origin: 'metamask',
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
      expect(response).toMatchObject({ pending: false });
      expect(() =>
        create(
          (response as { pending: false; result: Json }).result,
          SignTransactionResponseStruct,
        ),
      ).not.toThrow();
    });
  });

  describe('setSelectedAccounts', () => {
    it('schedules a background event to synchronize the selected accounts', async () => {
      const syncSpy = jest.spyOn(
        SyncAccountsHandler,
        'scheduleBackgroundEvent',
      );

      await keyringHandler.setSelectedAccounts([mockAccountId]);

      expect(syncSpy).toHaveBeenCalledWith(
        {
          accountIds: [mockAccountId],
        },
        Duration.OneSecond,
      );
    });

    it('throws an error if the account ids are invalid', async () => {
      await expect(
        keyringHandler.setSelectedAccounts(['invalid:account:id']),
      ).rejects.toThrow(InvalidParamsError);
    });
  });
});
