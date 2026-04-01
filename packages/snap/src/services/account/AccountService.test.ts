import type { AccountService } from './AccountService';
import { AccountsRepository } from './AccountsRepository';
import type { StellarKeyringAccount } from './api';
import { getDerivationPath } from './derivation';
import {
  AccountNotFoundException,
  AccountRollbackException,
  DerivedAccountAddressMismatchException,
} from './exceptions';
import { KnownCaip2ChainId, MultichainMethod } from '../../api';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { getBip32Entropy, getDefaultEntropySource } from '../../utils/snap';
import { Wallet, WalletService } from '../wallet';
import {
  generateMockStellarKeyringAccounts,
  mockAccountService,
} from './__mocks__/fixtures';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('AccountService', () => {
  let accountService: AccountService;
  let mockAccount: StellarKeyringAccount;

  beforeEach(() => {
    // Mock the entropy source to let the wallet service derive the address
    jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);
    accountService = mockAccountService().accountService;
    mockAccount = generateMockStellarKeyringAccounts(
      1,
      'entropy-source-default',
    )[0] as StellarKeyringAccount;
  });

  const getAccountsRepositorySpies = () => {
    return {
      createSpy: jest.spyOn(AccountsRepository.prototype, 'create'),
      deleteSpy: jest.spyOn(AccountsRepository.prototype, 'delete'),
      getAllSpy: jest.spyOn(AccountsRepository.prototype, 'getAll'),
    };
  };

  const getWalletServiceSpies = () => ({
    deriveAddressSpy: jest.spyOn(WalletService.prototype, 'deriveAddress'),
    resolveActivatedAccountSpy: jest.spyOn(
      WalletService.prototype,
      'resolveActivatedAccount',
    ),
    isAccountActivatedSpy: jest.spyOn(
      WalletService.prototype,
      'isAccountActivated',
    ),
  });

  describe('create', () => {
    it('creates an account with default options', async () => {
      const entropySource = 'entropy-source-default';
      const expectedIndex = 0;
      const expectedDerivationPath = getDerivationPath(expectedIndex);
      const { deriveAddressSpy } = getWalletServiceSpies();
      const { createSpy, getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);
      jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySource);

      const result = await accountService.create();

      expect(createSpy).toHaveBeenCalledWith(result);
      expect(deriveAddressSpy).toHaveBeenCalledWith({
        entropySource,
        index: expectedIndex,
      });
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource,
        derivationPath: expectedDerivationPath,
        index: expectedIndex,
        type: 'any:account',
        address: expect.any(String),
        scopes: [KnownCaip2ChainId.Mainnet],
        methods: ['signMessage', 'signTransaction'],
        options: {
          entropy: {
            type: 'mnemonic',
            id: entropySource,
            derivationPath: expectedDerivationPath,
            groupIndex: expectedIndex,
          },
          exportable: true,
          groupIndex: expectedIndex,
        },
      });
    });

    it('creates an account with options', async () => {
      const { createSpy, getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      const result = await accountService.create({
        entropySource: 'entropy-source-2',
        index: 1,
      });

      expect(createSpy).toHaveBeenCalledWith(result);
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource: 'entropy-source-2',
        derivationPath: "m/44'/148'/1'",
        index: 1,
        type: 'any:account',
        address: expect.any(String),
        scopes: [KnownCaip2ChainId.Mainnet],
        methods: [
          MultichainMethod.SignMessage,
          MultichainMethod.SignTransaction,
        ],
        options: {
          entropy: {
            type: 'mnemonic',
            id: 'entropy-source-2',
            derivationPath: "m/44'/148'/1'",
            groupIndex: 1,
          },
          exportable: true,
          groupIndex: 1,
        },
      });
    });

    it('creates an account with lowest unused index', async () => {
      const { createSpy, getAllSpy } = getAccountsRepositorySpies();
      const entropySource = 'entropy-source-2';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, ...restAccounts] = generateMockStellarKeyringAccounts(
        3,
        entropySource,
      );
      const expectedIndex = 0;
      const expectedDerivationPath = getDerivationPath(expectedIndex);
      getAllSpy.mockResolvedValue(restAccounts);

      const result = await accountService.create({
        entropySource,
      });

      expect(createSpy).toHaveBeenCalledWith(result);
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource,
        derivationPath: expectedDerivationPath,
        index: expectedIndex,
        type: 'any:account',
        address: expect.any(String),
        scopes: [KnownCaip2ChainId.Mainnet],
        methods: [
          MultichainMethod.SignMessage,
          MultichainMethod.SignTransaction,
        ],
        options: {
          entropy: {
            type: 'mnemonic',
            id: entropySource,
            derivationPath: expectedDerivationPath,
            groupIndex: expectedIndex,
          },
          exportable: true,
          groupIndex: expectedIndex,
        },
      });
    });

    it('returns an existing account if it already exists', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const entropySource = 'entropy-source-1';
      const mockAccounts = generateMockStellarKeyringAccounts(5, entropySource);
      getAllSpy.mockResolvedValue(mockAccounts);

      const result = await accountService.create({
        entropySource,
        index: 0,
      });

      expect(result).toStrictEqual(mockAccounts[0]);
    });

    it('creates an account with a callback', async () => {
      const { createSpy } = getAccountsRepositorySpies();
      const callback = jest.fn();

      const result = await accountService.create(
        {
          entropySource: 'entropy-source-1',
          index: 0,
        },
        callback,
      );

      expect(callback).toHaveBeenCalledWith(result);
      expect(createSpy).toHaveBeenCalledWith(result);
    });

    it('deletes the account and throws an error if the callback fails', async () => {
      const { createSpy, deleteSpy } = getAccountsRepositorySpies();
      const callback = jest
        .fn()
        .mockRejectedValue(new Error('Callback failed'));

      await expect(
        accountService.create(
          {
            entropySource: 'entropy-source-1',
            index: 0,
          },
          callback,
        ),
      ).rejects.toThrow('Callback failed');

      expect(createSpy.mock.calls[0]?.[0]?.id).toStrictEqual(
        expect.any(String),
      );
      expect(deleteSpy).toHaveBeenCalledWith(createSpy.mock.calls[0]?.[0]?.id);
      expect(createSpy).toHaveBeenCalled();
    });

    it('throws AccountRollbackException if the rollback fails', async () => {
      const { deleteSpy } = getAccountsRepositorySpies();
      const callback = jest
        .fn()
        .mockRejectedValue(new Error('Callback failed'));
      deleteSpy.mockRejectedValue(new Error('Rollback failed'));

      await expect(
        accountService.create(
          {
            entropySource: 'entropy-source-1',
            index: 0,
          },
          callback,
        ),
      ).rejects.toThrow(AccountRollbackException);
    });
  });

  describe('delete', () => {
    it('deletes an account', async () => {
      const { deleteSpy } = getAccountsRepositorySpies();
      const account = await accountService.create();

      await accountService.delete(account.id);

      expect(deleteSpy).toHaveBeenCalledWith(account.id);
    });
  });

  describe('findById', () => {
    it('finds an account by its ID', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const account = mockAccounts[0] as StellarKeyringAccount;
      getAllSpy.mockResolvedValue(mockAccounts);

      const result = await accountService.findById(account.id);
      expect(result).toStrictEqual(account);
    });

    it('returns undefined if the account is not found', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      const result = await accountService.findById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('listAccounts', () => {
    it('lists all accounts', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      getAllSpy.mockResolvedValue(mockAccounts);

      const result = await accountService.listAccounts();
      expect(result).toStrictEqual(mockAccounts);
    });
  });

  describe('resolveAccount', () => {
    it('resolves an account regardless of activation status with given address', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const { deriveAddressSpy } = getWalletServiceSpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const account = mockAccounts[0] as StellarKeyringAccount;
      deriveAddressSpy.mockResolvedValue(account.address);
      getAllSpy.mockResolvedValue(mockAccounts);

      const result = await accountService.resolveAccount({
        accountIdOrAddress: account.address,
        scope: KnownCaip2ChainId.Mainnet,
        resolveOptions: {
          activated: false,
        },
      });
      expect(result).toStrictEqual({
        account,
        wallet: undefined,
      });
    });

    it('resolves an account regardless of activation status with given account ID', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const { deriveAddressSpy } = getWalletServiceSpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const account = mockAccounts[0] as StellarKeyringAccount;
      deriveAddressSpy.mockResolvedValue(account.address);
      getAllSpy.mockResolvedValue(mockAccounts);

      const result = await accountService.resolveAccount({
        accountIdOrAddress: account.id,
        scope: KnownCaip2ChainId.Mainnet,
        resolveOptions: {
          activated: false,
        },
      });
      expect(result).toStrictEqual({
        account,
        wallet: undefined,
      });
    });

    it('resolves an activated account', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const { deriveAddressSpy, resolveActivatedAccountSpy } =
        getWalletServiceSpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const account = mockAccounts[0] as StellarKeyringAccount;
      const loadedAccount = {
        accountId(): string {
          return account.address;
        },
        sequenceNumber(): string {
          return '1';
        },
      };
      const resolvedWallet = new Wallet(loadedAccount, null);
      deriveAddressSpy.mockResolvedValue(account.address);
      getAllSpy.mockResolvedValue(mockAccounts);
      resolveActivatedAccountSpy.mockResolvedValue(resolvedWallet);

      const result = await accountService.resolveAccount({
        accountIdOrAddress: account.address,
        scope: KnownCaip2ChainId.Mainnet,
        resolveOptions: {
          activated: true,
        },
      });
      expect(result).toStrictEqual({
        account,
        wallet: resolvedWallet,
      });
    });

    it('throws AccountNotFoundException if the account address is not found in the keyring', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      await expect(
        accountService.resolveAccount({
          accountIdOrAddress:
            'GNXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          scope: KnownCaip2ChainId.Mainnet,
          resolveOptions: {
            activated: false,
          },
        }),
      ).rejects.toThrow(AccountNotFoundException);
    });

    it('throws AccountNotFoundException if the account id is not found in the keyring', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      await expect(
        accountService.resolveAccount({
          accountIdOrAddress: '00000000-0000-0000-0000-000000000000',
          scope: KnownCaip2ChainId.Mainnet,
          resolveOptions: {
            activated: false,
          },
        }),
      ).rejects.toThrow(AccountNotFoundException);
    });

    it('throws an error if the address is not the same as the derived account address', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      const { deriveAddressSpy } = getWalletServiceSpies();
      const mockAccounts = generateMockStellarKeyringAccounts(
        5,
        'entropy-source-1',
      );
      const account = mockAccounts[0] as StellarKeyringAccount;
      const derivedAccount = mockAccounts[1] as StellarKeyringAccount;
      getAllSpy.mockResolvedValue(mockAccounts);
      deriveAddressSpy.mockResolvedValue(derivedAccount.address);

      await expect(
        accountService.resolveAccount({
          accountIdOrAddress: account.address,
          scope: KnownCaip2ChainId.Mainnet,
          resolveOptions: {
            activated: false,
          },
        }),
      ).rejects.toThrow(DerivedAccountAddressMismatchException);
    });
  });

  describe('discoverOnChainAccount', () => {
    it('discovers an activated account', async () => {
      const { isAccountActivatedSpy, deriveAddressSpy } =
        getWalletServiceSpies();
      isAccountActivatedSpy.mockResolvedValue(true);
      deriveAddressSpy.mockResolvedValue(mockAccount.address);

      const account = await accountService.discoverOnChainAccount({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(account).toStrictEqual({
        ...mockAccount,
        id: expect.any(String),
      });
    });

    it('returns null if the account is not activated on the Stellar network', async () => {
      const { isAccountActivatedSpy } = getWalletServiceSpies();
      isAccountActivatedSpy.mockResolvedValue(false);

      const account = await accountService.discoverOnChainAccount({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(account).toBeNull();
    });
  });
});
