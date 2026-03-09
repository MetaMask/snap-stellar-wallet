import { AccountService } from './AccountService';
import { AccountsRepository } from './AccountsRepository';
import { KnownCaip2ChainId } from '../../constants';
import { logger } from '../../utils';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { getBip32Entropy, getDefaultEntropySource } from '../../utils/snap';
import { State } from '../state';
import { KeypairService } from '../wallet';
import { generateMockStellarKeyringAccounts } from './__mocks__/fixtures';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('AccountService', () => {
  let accountService: AccountService;

  beforeEach(() => {
    jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);

    const state = new State({
      encrypted: false,
      defaultState: {
        keyringAccounts: {},
      },
    });

    accountService = new AccountService({
      logger,
      keypairService: new KeypairService({ logger }),
      accountsRepository: new AccountsRepository(state),
    });
  });

  const getAccountsRepositorySpies = () => {
    return {
      createSpy: jest.spyOn(AccountsRepository.prototype, 'create'),
      deleteSpy: jest.spyOn(AccountsRepository.prototype, 'delete'),
      getAllSpy: jest.spyOn(AccountsRepository.prototype, 'getAll'),
    };
  };

  describe('deriveAccount', () => {
    it('derive an account', async () => {
      const entropySource = 'entropy-source-1';
      const index = 0;
      const expectedDerivationPath = KeypairService.getDerivationPath(index);

      const result = await accountService.deriveAccount({
        entropySource,
        index,
      });

      expect(result).toStrictEqual({
        id: expect.any(String),
        entropySource: 'entropy-source-1',
        derivationPath: expectedDerivationPath,
        index,
        type: 'any:account',
        address: expect.any(String),
        scopes: [KnownCaip2ChainId.Mainnet],
        methods: ['signMessage', 'signTransaction'],
        options: {
          entropy: {
            type: 'mnemonic',
            id: entropySource,
            derivationPath: expectedDerivationPath,
            groupIndex: index,
          },
          exportable: true,
        },
      });
    });
  });

  describe('create', () => {
    it('creates an account with default options', async () => {
      const { createSpy, getAllSpy } = getAccountsRepositorySpies();
      const entropySource = 'entropy-source-default';
      const expectedIndex = 0;
      const expectedDerivationPath =
        KeypairService.getDerivationPath(expectedIndex);
      getAllSpy.mockResolvedValue([]);
      jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySource);

      const result = await accountService.create();

      expect(createSpy).toHaveBeenCalledWith(result);
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
        methods: ['signMessage', 'signTransaction'],
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
      const expectedDerivationPath =
        KeypairService.getDerivationPath(expectedIndex);
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
  });

  describe('delete', () => {
    it('deletes an account', async () => {
      const { deleteSpy } = getAccountsRepositorySpies();
      const account = await accountService.create();

      await accountService.delete(account.id);

      expect(deleteSpy).toHaveBeenCalledWith(account.id);
    });
  });
});
