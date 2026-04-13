import type { AccountService } from './AccountService';
import { AccountsRepository } from './AccountsRepository';
import type { StellarKeyringAccount } from './api';
import {
  AccountNotFoundException,
  AccountRollbackException,
  DerivedAccountAddressMismatchException,
} from './exceptions';
import { KnownCaip2ChainId } from '../../api';
import { KEYRING_ACCOUNT_TYPE } from '../../constants';
import { MultichainMethod } from '../../handlers/keyring';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { getBip32Entropy, getDefaultEntropySource } from '../../utils/snap';
import { WalletService, getDerivationPath } from '../wallet';
import {
  generateMockStellarKeyringAccounts,
  mockAccountService,
} from './__mocks__/account.fixtures';

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
      saveSpy: jest.spyOn(AccountsRepository.prototype, 'save'),
      deleteSpy: jest.spyOn(AccountsRepository.prototype, 'delete'),
      getAllSpy: jest.spyOn(AccountsRepository.prototype, 'getAll'),
    };
  };

  const getWalletServiceSpies = () => ({
    deriveAddressSpy: jest.spyOn(WalletService.prototype, 'deriveAddress'),
  });

  describe('create', () => {
    it('creates an account with default options', async () => {
      const entropySource = 'entropy-source-default';
      const expectedIndex = 0;
      const expectedDerivationPath = getDerivationPath(expectedIndex);
      const { deriveAddressSpy } = getWalletServiceSpies();
      const { saveSpy, getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);
      jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySource);

      const result = await accountService.create();

      expect(saveSpy).toHaveBeenCalledWith(result);
      expect(deriveAddressSpy).toHaveBeenCalledWith({
        entropySource,
        index: expectedIndex,
      });
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource,
        derivationPath: expectedDerivationPath,
        index: expectedIndex,
        type: KEYRING_ACCOUNT_TYPE,
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
      const { saveSpy, getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      const result = await accountService.create({
        entropySource: 'entropy-source-2',
        index: 1,
      });

      expect(saveSpy).toHaveBeenCalledWith(result);
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource: 'entropy-source-2',
        derivationPath: "m/44'/148'/1'",
        index: 1,
        type: KEYRING_ACCOUNT_TYPE,
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
      const { saveSpy, getAllSpy } = getAccountsRepositorySpies();
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

      expect(saveSpy).toHaveBeenCalledWith(result);
      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource,
        derivationPath: expectedDerivationPath,
        index: expectedIndex,
        type: KEYRING_ACCOUNT_TYPE,
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
      const { saveSpy } = getAccountsRepositorySpies();
      const callback = jest.fn();

      const result = await accountService.create(
        {
          entropySource: 'entropy-source-1',
          index: 0,
        },
        callback,
      );

      expect(callback).toHaveBeenCalledWith(result);
      expect(saveSpy).toHaveBeenCalledWith(result);
    });

    it('deletes the account and throws an error if the callback fails', async () => {
      const { saveSpy, deleteSpy } = getAccountsRepositorySpies();
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

      expect(saveSpy.mock.calls[0]?.[0]?.id).toStrictEqual(expect.any(String));
      expect(deleteSpy).toHaveBeenCalledWith(saveSpy.mock.calls[0]?.[0]?.id);
      expect(saveSpy).toHaveBeenCalled();
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
        accountAddress: account.address,
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(result).toStrictEqual({
        account,
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
        accountId: account.id,
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(result).toStrictEqual({
        account,
      });
    });

    it('throws AccountNotFoundException if the account address is not found in the keyring', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      await expect(
        accountService.resolveAccount({
          accountAddress:
            'GNXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          scope: KnownCaip2ChainId.Mainnet,
        }),
      ).rejects.toThrow(AccountNotFoundException);
    });

    it('throws AccountNotFoundException if the account id is not found in the keyring', async () => {
      const { getAllSpy } = getAccountsRepositorySpies();
      getAllSpy.mockResolvedValue([]);

      await expect(
        accountService.resolveAccount({
          accountId: '00000000-0000-0000-0000-000000000000',
          scope: KnownCaip2ChainId.Mainnet,
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
          accountAddress: account.address,
          scope: KnownCaip2ChainId.Mainnet,
        }),
      ).rejects.toThrow(DerivedAccountAddressMismatchException);
    });
  });

  describe('deriveKeyringAccount', () => {
    it('returns a keyring-shaped derived account', async () => {
      const { deriveAddressSpy } = getWalletServiceSpies();
      deriveAddressSpy.mockResolvedValue(mockAccount.address);

      const account = await accountService.deriveKeyringAccount({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
      });

      expect(account).toStrictEqual({
        ...mockAccount,
        id: expect.any(String),
      });
    });
  });
});
