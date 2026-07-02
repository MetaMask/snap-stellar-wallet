import type { KeyringAccount } from '@metamask/keyring-api';
import {
  AccountCreationType,
  DiscoveredAccountType,
  KeyringEvent,
  KeyringRpcMethod,
} from '@metamask/keyring-api';
import { KeyringRpcMethod as KeyringRpcMethodV2 } from '@metamask/keyring-api/v2';
import {
  emitSnapKeyringEvent,
  MethodNotSupportedError,
} from '@metamask/keyring-snap-sdk';
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk/v2';
import { InvalidParamsError, type JsonRpcRequest } from '@metamask/snaps-sdk';
import { create } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import {
  MultichainMethod,
  SignAuthEntryResponseStruct,
  SignMessageResponseStruct,
  SignTransactionResponseStruct,
} from './api';
import type { IKeyringRequestHandler } from './base';
import {
  KeyringAccountRollbackException,
  KeyringEmitAccountCreatedEventException,
  KeyringEmitAccountDeletedEventException,
} from './exceptions';
import { KeyringHandler } from './keyring';
import { KnownCaip2ChainId } from '../../api';
import { KEYRING_ACCOUNT_TYPE, METAMASK_ORIGIN } from '../../constants';
import {
  AccountService,
  type StellarKeyringAccount,
} from '../../services/account';
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
  type MockAccountWithBalancesData,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import {
  createMockTransactionService,
  generateMockTransactions,
} from '../../services/transaction/__mocks__/transaction.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import {
  getSlip44AssetId,
  getDefaultEntropySource,
  getSnapProvider,
  Duration,
} from '../../utils';
import { bufferToUint8Array } from '../../utils/buffer';
import { logger } from '../../utils/logger';
import { AccountResolver } from '../accountResolver';
import { SyncAccountsHandler } from '../cronjob/syncAccounts';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('../../utils/requestResponse', () => ({
  ...jest.requireActual('../../utils/requestResponse'),
  validateOrigin: jest.fn(),
}));
jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
  MethodNotSupportedError: jest.requireActual('@metamask/keyring-snap-sdk')
    .MethodNotSupportedError,
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

  const mockCreateAccountResult = (
    account: StellarKeyringAccount,
    isNewAccount = true,
  ) => ({ account, isNewAccount });

  const getAccountServiceSpies = () => ({
    listAccountsSpy: jest.spyOn(AccountService.prototype, 'listAccounts'),
    findByIdSpy: jest.spyOn(AccountService.prototype, 'findById'),
    deleteSpy: jest.spyOn(AccountService.prototype, 'delete'),
    resolveAccountSpy: jest.spyOn(AccountService.prototype, 'resolveAccount'),
    createAccountSpy: jest.spyOn(AccountService.prototype, 'create'),
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

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    const { transactionService } = createMockTransactionService();
    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });
    keyringHandler = new KeyringHandler({
      logger,
      accountService,
      onChainAccountService,
      transactionService,
      accountResolver,
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
    const request = {
      method: KeyringRpcMethod.ListAccounts,
      id: '1',
      jsonrpc: '2.0',
    } as JsonRpcRequest;

    it('calls handleKeyringRequest', async () => {
      const handleKeyringRequestSpy = jest.mocked(handleKeyringRequest);
      handleKeyringRequestSpy.mockResolvedValue([]);

      const result = await keyringHandler.handle(METAMASK_ORIGIN, request);

      expect(handleKeyringRequestSpy).toHaveBeenCalledWith(
        keyringHandler,
        request,
      );
      expect(result).toStrictEqual([]);
    });

    it('returns null if handleKeyringRequest returns null', async () => {
      const handleKeyringRequestSpy = jest.mocked(handleKeyringRequest);
      handleKeyringRequestSpy.mockResolvedValue(null);

      const result = await keyringHandler.handle(METAMASK_ORIGIN, request);

      expect(handleKeyringRequestSpy).toHaveBeenCalledWith(
        keyringHandler,
        request,
      );
      expect(result).toBeNull();
    });

    it('redacts the exportAccount result before debug-logging it', async () => {
      const exportedAccount = {
        type: 'private-key',
        encoding: 'hexadecimal',
        privateKey: `0x${'a'.repeat(64)}`,
      };
      const exportRequest = {
        method: KeyringRpcMethodV2.ExportAccount,
        id: '1',
        jsonrpc: '2.0',
      } as JsonRpcRequest;
      jest
        .mocked(handleKeyringRequest)
        .mockResolvedValue(exportedAccount as unknown as Json);

      const result = await keyringHandler.handle(
        METAMASK_ORIGIN,
        exportRequest,
      );

      expect(result).toStrictEqual(exportedAccount);
      expect(jest.mocked(logger.debug)).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          result: expect.objectContaining({ privateKey: expect.anything() }),
        }),
      );
      expect(jest.mocked(logger.debug)).toHaveBeenCalledWith(
        expect.anything(),
        'Keyring request handled',
        expect.objectContaining({ result: '[redacted]' }),
      );
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

    it('propagates errors when account listing fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'listAccounts')
        .mockRejectedValue(new Error('Account listing failed'));

      await expect(keyringHandler.listAccounts()).rejects.toThrow(
        'Account listing failed',
      );
    });
  });

  describe('getAccount', () => {
    it('gets an account by its ID', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });

      const result = await keyringHandler.getAccount(mockAccountId);

      expect(resolveAccountSpy).toHaveBeenCalledWith({
        accountId: mockAccountId,
      });
      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
    });

    it('propagates errors when account retrieval fails', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new Error('Account retrieval failed'),
      );

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
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new AccountNotFoundException(NON_EXISTENT_ID),
      );

      await expect(keyringHandler.getAccount(NON_EXISTENT_ID)).rejects.toThrow(
        AccountNotFoundException,
      );
    });
  });

  describe('getAccounts', () => {
    it('returns the same result as listAccounts', async () => {
      const { listAccountsSpy } = getAccountServiceSpies();
      listAccountsSpy.mockResolvedValue([mockAccount]);

      expect(await keyringHandler.getAccounts()).toStrictEqual(
        await keyringHandler.listAccounts(),
      );
    });
  });

  describe('exportAccount', () => {
    const setupExportWallet = () => {
      const wallet = getTestWallet();
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      const resolveWalletSpy = jest
        .spyOn(WalletService.prototype, 'resolveWallet')
        .mockResolvedValue(wallet);

      return { wallet, resolveAccountSpy, resolveWalletSpy };
    };

    it('returns the hex-encoded raw seed by default', async () => {
      setupExportWallet();

      const result = await keyringHandler.exportAccount(mockAccountId);

      expect(result).toStrictEqual({
        type: 'private-key',
        encoding: 'hexadecimal',
        privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
      });
    });

    it('respects the requested base58 encoding', async () => {
      setupExportWallet();

      const result = await keyringHandler.exportAccount(mockAccountId, {
        type: 'private-key',
        encoding: 'base58',
      });

      expect(result.encoding).toBe('base58');
    });

    it('throws for an unknown account id', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new AccountNotFoundException(NON_EXISTENT_ID),
      );

      await expect(
        keyringHandler.exportAccount(NON_EXISTENT_ID),
      ).rejects.toThrow(AccountNotFoundException);
    });
  });

  describe('createAccount', () => {
    it('creates an account', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockCreateAccountResult(mockAccount));

      const result = await keyringHandler.createAccount();

      expect(createAccountSpy).toHaveBeenCalledTimes(1);
      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
    });

    it('emits the account-created event', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockCreateAccountResult(mockAccount));
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

    it('does not emit account-created event for an existing account', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(
        mockCreateAccountResult(mockAccount, false),
      );
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);

      const result = await keyringHandler.createAccount();

      expect(result).toStrictEqual(toKeyringAccount(mockAccount));
      expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
    });

    it('propagates errors when account creation fails', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockRejectedValue(new Error('Account creation failed'));

      await expect(keyringHandler.createAccount()).rejects.toThrow(
        'Account creation failed',
      );
    });

    it('rolls back and throws when account-created event emission fails', async () => {
      const { createAccountSpy, deleteSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockCreateAccountResult(mockAccount));
      deleteSpy.mockResolvedValue(undefined);
      jest
        .mocked(emitSnapKeyringEvent)
        .mockRejectedValue(new Error('User rejected'));

      await expect(keyringHandler.createAccount()).rejects.toThrow(
        KeyringEmitAccountCreatedEventException,
      );
      expect(deleteSpy).toHaveBeenCalledWith(mockAccount.id);
    });

    it('throws KeyringAccountRollbackException when rollback fails', async () => {
      const { createAccountSpy, deleteSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockCreateAccountResult(mockAccount));
      deleteSpy.mockRejectedValue(new Error('Rollback failed'));
      jest
        .mocked(emitSnapKeyringEvent)
        .mockRejectedValue(new Error('User rejected'));

      await expect(keyringHandler.createAccount()).rejects.toThrow(
        KeyringAccountRollbackException,
      );
    });
  });

  describe('createAccounts', () => {
    it('creates one account for bip44:derive-index without emitting AccountCreated', async () => {
      const { createAccountSpy } = getAccountServiceSpies();
      createAccountSpy.mockResolvedValue(mockCreateAccountResult(mockAccount));
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44DeriveIndex,
        entropySource: entropySourceId,
        groupIndex: 2,
      });

      expect(createAccountSpy).toHaveBeenCalledTimes(1);
      expect(createAccountSpy).toHaveBeenCalledWith({
        entropySource: entropySourceId,
        index: 2,
      });
      expect(result).toStrictEqual([toKeyringAccount(mockAccount)]);
      expect(emitSnapKeyringEventSpy).not.toHaveBeenCalled();
    });

    it('creates accounts for each index in bip44:derive-index-range', async () => {
      const { batchCreateAccountSpy } = getAccountServiceSpies();
      const accountAt1 = generateStellarKeyringAccount(
        'id-1',
        mockAccount.address,
        entropySourceId,
        1,
      );
      const accountAt2 = generateStellarKeyringAccount(
        'id-2',
        mockAccount.address,
        entropySourceId,
        2,
      );
      const accountAt3 = generateStellarKeyringAccount(
        'id-3',
        mockAccount.address,
        entropySourceId,
        3,
      );
      batchCreateAccountSpy.mockResolvedValue([
        accountAt1,
        accountAt2,
        accountAt3,
      ]);

      const result = await keyringHandler.createAccounts({
        type: AccountCreationType.Bip44DeriveIndexRange,
        entropySource: entropySourceId,
        range: { from: 1, to: 3 },
      });

      expect(batchCreateAccountSpy).toHaveBeenCalledTimes(1);
      expect(batchCreateAccountSpy).toHaveBeenCalledWith({
        entropySource: entropySourceId,
        fromIndex: 1,
        toIndex: 3,
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.options).toMatchObject({
        entropy: expect.objectContaining({ groupIndex: 1 }),
      });
      expect(result[1]?.options).toMatchObject({
        entropy: expect.objectContaining({ groupIndex: 2 }),
      });
      expect(result[2]?.options).toMatchObject({
        entropy: expect.objectContaining({ groupIndex: 3 }),
      });
      expect(jest.mocked(emitSnapKeyringEvent)).not.toHaveBeenCalled();
    });

    it('propagates errors when account creation fails', async () => {
      const { createAccountSpy, batchCreateAccountSpy } =
        getAccountServiceSpies();
      createAccountSpy.mockRejectedValue(new Error('Batch create failed'));
      batchCreateAccountSpy.mockRejectedValue(new Error('Batch create failed'));

      await expect(
        keyringHandler.createAccounts({
          type: AccountCreationType.Bip44DeriveIndex,
          entropySource: entropySourceId,
          groupIndex: 0,
        }),
      ).rejects.toThrow('Batch create failed');

      await expect(
        keyringHandler.createAccounts({
          type: AccountCreationType.Bip44DeriveIndexRange,
          entropySource: entropySourceId,
          range: { from: 0, to: 2 },
        }),
      ).rejects.toThrow('Batch create failed');
    });

    it('throws when create account option type is not supported', async () => {
      await expect(
        keyringHandler.createAccounts({
          type: AccountCreationType.Bip44Discover,
          entropySource: entropySourceId,
          groupIndex: 0,
        }),
      ).rejects.toThrow('Unsupported create account option type');
    });
  });

  describe('listAccountAssets', () => {
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

      const result = await keyringHandler.listAccountAssets(mockAccountId);

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

      const result = await keyringHandler.listAccountAssets(mockAccountId);

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
        keyringHandler.listAccountAssets(mockAccountId),
      ).rejects.toThrow('Horizon unavailable');
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
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(10, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

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
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(30, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

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
      const { transactionServiceFindByAccountIdSpy } =
        createMockTransactionService();
      const mockTransactions = generateMockTransactions(5, {
        account: mockAccountId,
        scope: KnownCaip2ChainId.Mainnet,
        fromAddress: mockAccount.address,
      });
      transactionServiceFindByAccountIdSpy.mockResolvedValue(mockTransactions);

      await expect(
        keyringHandler.listAccountTransactions(mockAccountId, {
          limit: 2,
          next: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(InvalidParamsError);
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

    it('returns empty array if the account is not activated on any requested scope', async () => {
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

    it('returns empty array when the account is not activated on any of multiple scopes', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      const isAccountActivatedSpy = jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValue(false);

      const scopes = [KnownCaip2ChainId.Mainnet, KnownCaip2ChainId.Testnet];
      const result = await keyringHandler.discoverAccounts(
        scopes,
        'entropy-source-1',
        0,
      );

      expect(isAccountActivatedSpy).toHaveBeenCalledTimes(2);
      expect(isAccountActivatedSpy).toHaveBeenCalledWith({
        accountAddress: mockAccount.address,
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(isAccountActivatedSpy).toHaveBeenCalledWith({
        accountAddress: mockAccount.address,
        scope: KnownCaip2ChainId.Testnet,
      });
      expect(result).toStrictEqual([]);
    });

    it('discovers an account when activated on any requested scope', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      jest
        .spyOn(OnChainAccountService.prototype, 'isAccountActivated')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const scopes = [KnownCaip2ChainId.Mainnet, KnownCaip2ChainId.Testnet];
      const result = await keyringHandler.discoverAccounts(
        scopes,
        'entropy-source-1',
        0,
      );

      expect(result).toStrictEqual([
        {
          type: DiscoveredAccountType.Bip44,
          scopes,
          derivationPath: mockAccount.derivationPath,
        },
      ]);
    });

    it('propagates errors when account discovery fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockRejectedValue(new Error('Account discovery failed'));

      await expect(
        keyringHandler.discoverAccounts(
          [KnownCaip2ChainId.Mainnet],
          'entropy-source-1',
          0,
        ),
      ).rejects.toThrow('Account discovery failed');
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
      const onChainAccount = createTestOnChainAccount(mockAccount.address, {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 1.000001,
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
        [slipId]: { unit: 'XLM', amount: '1.000001' },
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
    it('throws MethodNotSupportedError', async () => {
      await expect(
        keyringHandler.filterAccountChains('1', [KnownCaip2ChainId.Mainnet]),
      ).rejects.toThrow(MethodNotSupportedError);
    });
  });

  describe('updateAccount', () => {
    it('throws MethodNotSupportedError', async () => {
      await expect(
        keyringHandler.updateAccount({
          type: KEYRING_ACCOUNT_TYPE,
          id: '1',
          address: '1',
          scopes: [KnownCaip2ChainId.Mainnet],
          options: {},
          methods: [],
        }),
      ).rejects.toThrow(MethodNotSupportedError);
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

    it('propagates errors when account deletion fails', async () => {
      const { deleteSpy, resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      deleteSpy.mockRejectedValue(new Error('Account deletion failed'));
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        'Account deletion failed',
      );
    });

    it('throws KeyringEmitAccountDeletedEventException when delete event emission fails', async () => {
      const { deleteSpy, resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockResolvedValue({ account: mockAccount });
      jest
        .mocked(emitSnapKeyringEvent)
        .mockRejectedValue(new Error('Event emission failed'));

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        KeyringEmitAccountDeletedEventException,
      );
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('propagates AccountNotFoundException when the account to delete is not found', async () => {
      const { resolveAccountSpy } = getAccountServiceSpies();
      resolveAccountSpy.mockRejectedValue(
        new AccountNotFoundException(mockAccountId),
      );

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        AccountNotFoundException,
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
        origin: METAMASK_ORIGIN,
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
      expect(result).toStrictEqual({
        pending: false,
        result: expectedResult,
      });
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
      expect(result).toStrictEqual({
        pending: false,
        result: expectedResult,
      });
    });

    it('throws an error if the request is invalid', async () => {
      await expect(
        keyringHandler.submitRequest({
          id: keyringRequestId,
          origin: METAMASK_ORIGIN,
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
      expect(response).toMatchObject({ pending: false });
      expect(() =>
        create(
          (response as { pending: false; result: Json }).result,
          SignTransactionResponseStruct,
        ),
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
      expect(response).toMatchObject({ pending: false });
      expect(() =>
        create(
          (response as { pending: false; result: Json }).result,
          SignAuthEntryResponseStruct,
        ),
      ).not.toThrow();
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
