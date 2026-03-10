import type { KeyringAccount } from '@metamask/keyring-api';
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

import { KeyringHandler } from './keyring';
import { StellarMultichainMethod } from './types';
import { mockAccountService } from '../../__mocks__/services';
import { KnownCaip2ChainId, KnownCaip19Id } from '../../constants';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/fixtures';
import { AccountService } from '../../services/account/AccountService';
import type { StellarKeyringAccount } from '../../services/account/AccountsRepository';
import { KeypairService } from '../../services/wallet/KeypairService';
import {
  getBip32Entropy,
  getDefaultEntropySource,
  getSnapProvider,
} from '../../utils';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { logger } from '../../utils/logger';

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
  let keyringHandler: KeyringHandler;

  const entropySourceId = 'entropy-source-1';
  const mockAccount = generateMockStellarKeyringAccounts(
    1,
    entropySourceId,
  )[0] as StellarKeyringAccount;
  const mockAccountId = mockAccount.id;

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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);
    jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySourceId);

    const { accountService } = mockAccountService();
    keyringHandler = new KeyringHandler({
      logger,
      accountService,
    });
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
        'Error listing accounts: Account listing failed',
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
        'Error getting account: Account retrieval failed',
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
      const expectedIndex = 0;
      const expectedDerivationPath =
        KeypairService.getDerivationPath(expectedIndex);
      const result = await keyringHandler.createAccount();

      expect(result).toStrictEqual({
        id: expect.any(String),
        address: expect.any(String),
        type: 'any:account',
        options: {
          entropy: {
            type: 'mnemonic',
            id: entropySourceId,
            derivationPath: expectedDerivationPath,
            groupIndex: expectedIndex,
          },
          exportable: true,
          groupIndex: expectedIndex,
        },
        methods: ['signMessage', 'signTransaction'],
        scopes: [KnownCaip2ChainId.Mainnet],
      });
    });

    it('emits the account-created event', async () => {
      const expectedIndex = 0;
      const expectedDerivationPath =
        KeypairService.getDerivationPath(expectedIndex);
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
          account: {
            id: expect.any(String),
            address: expect.any(String),
            type: 'any:account',
            options: {
              entropy: {
                type: 'mnemonic',
                id: entropySourceId,
                derivationPath: expectedDerivationPath,
                groupIndex: expectedIndex,
              },
              exportable: true,
              groupIndex: expectedIndex,
            },
            methods: ['signMessage', 'signTransaction'],
            scopes: [KnownCaip2ChainId.Mainnet],
          },
          displayConfirmation: false,
          correlationId: '123',
        }),
      );
    });

    it('throws an error if the account creation fails', async () => {
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockRejectedValue(
        new Error('Account creation failed'),
      );

      await expect(keyringHandler.createAccount()).rejects.toThrow(
        'Error creating account: Account creation failed',
      );
    });
  });

  describe('listAccountAssets', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.listAccountAssets('1')).rejects.toThrow(
        'Method not implemented.',
      );
    });
  });

  describe('listAccountTransactions', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.listAccountTransactions('1', { limit: 10 }),
      ).rejects.toThrow('Method not implemented.');
    });
  });

  describe('discoverAccounts', () => {
    it('discovers an account', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveAccount')
        .mockResolvedValue(mockAccount);

      const result = await keyringHandler.discoverAccounts(
        [KnownCaip2ChainId.Mainnet],
        'entropy-source-1',
        0,
      );

      expect(result).toStrictEqual([
        {
          type: DiscoveredAccountType.Bip44,
          scopes: [KnownCaip2ChainId.Mainnet],
          derivationPath: mockAccount.derivationPath,
        },
      ]);
    });

    it('throws an error if the account discovery fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'deriveAccount')
        .mockRejectedValue(new Error('Account discovery failed'));

      await expect(
        keyringHandler.discoverAccounts(
          [KnownCaip2ChainId.Mainnet],
          'entropy-source-1',
          0,
        ),
      ).rejects.toThrow('Error discovering accounts: Account discovery failed');
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
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.getAccountBalances('1', [KnownCaip19Id.Slip44Mainnet]),
      ).rejects.toThrow('Method not implemented.');
    });
  });

  describe('resolveAccountAddress', () => {
    it('resolves an account address', async () => {
      jest
        .spyOn(AccountService.prototype, 'resolveAccount')
        .mockResolvedValue(mockAccount.address);

      const result = await keyringHandler.resolveAccountAddress(
        KnownCaip2ChainId.Mainnet,
        {
          method: StellarMultichainMethod.SignMessage,
          id: '1',
          jsonrpc: '2.0',
          params: {
            address: mockAccount.address,
          },
        },
      );

      expect(result).toStrictEqual({
        address: `${KnownCaip2ChainId.Mainnet}:${mockAccount.address}`,
      });
    });

    it('throws an error if the account address resolution fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'resolveAccount')
        .mockRejectedValue(new Error('Account address resolution failed'));

      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: StellarMultichainMethod.SignMessage,
          id: '1',
          jsonrpc: '2.0',
          params: {
            address: mockAccount.address,
          },
        }),
      ).rejects.toThrow(
        'Error resolving account address: Account address resolution failed',
      );
    });

    it('throws an error if the account address resolution request is invalid', async () => {
      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: 'invalid:method' as StellarMultichainMethod,
          id: '1',
          jsonrpc: '2.0',
          params: {
            address: mockAccount.address,
          },
        }),
      ).rejects.toThrow(InvalidParamsError);
    });
  });

  describe('filterAccountChains', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.filterAccountChains('1', [KnownCaip2ChainId.Mainnet]),
      ).rejects.toThrow('Method not implemented.');
    });
  });

  describe('updateAccount', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.updateAccount({
          type: 'any:account',
          id: '1',
          address: '1',
          scopes: [KnownCaip2ChainId.Mainnet],
          options: {},
          methods: [],
        }),
      ).rejects.toThrow('Method not implemented.');
    });
  });

  describe('deleteAccount', () => {
    it('deletes an account', async () => {
      const deleteSpy = jest
        .spyOn(AccountService.prototype, 'delete')
        .mockResolvedValue();
      const findByIdSpy = jest
        .spyOn(AccountService.prototype, 'findById')
        .mockResolvedValue(mockAccount);
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await keyringHandler.deleteAccount(mockAccountId);

      expect(deleteSpy).toHaveBeenCalledWith(mockAccountId);
      expect(findByIdSpy).toHaveBeenCalledWith(mockAccountId);
      expect(emitSnapKeyringEventSpy).toHaveBeenCalledWith(
        getSnapProvider(),
        KeyringEvent.AccountDeleted,
        {
          id: mockAccountId,
        },
      );
    });

    it('throws an error if the account deletion fails', async () => {
      jest
        .spyOn(AccountService.prototype, 'delete')
        .mockRejectedValue(new Error('Account deletion failed'));
      jest
        .spyOn(AccountService.prototype, 'findById')
        .mockResolvedValue(mockAccount);
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        'Error deleting account: Account deletion failed',
      );
    });

    it('throws an error if the account to delete is not found', async () => {
      jest
        .spyOn(AccountService.prototype, 'findById')
        .mockResolvedValue(undefined);
      const emitSnapKeyringEventSpy = jest.mocked(emitSnapKeyringEvent);
      emitSnapKeyringEventSpy.mockResolvedValue();

      await expect(keyringHandler.deleteAccount(mockAccountId)).rejects.toThrow(
        `Error deleting account: Account not found: ${mockAccountId}`,
      );
    });

    it('throws an error if the account deletion request is invalid', async () => {
      await expect(keyringHandler.deleteAccount('not-uuid')).rejects.toThrow(
        InvalidParamsError,
      );
    });
  });

  describe('submitRequest', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.submitRequest({
          id: '1',
          origin: 'metamask',
          request: { method: 'submitRequest', params: ['1'] },
          scope: KnownCaip2ChainId.Mainnet,
          account: '1',
        }),
      ).rejects.toThrow('Method not implemented.');
    });
  });
});
