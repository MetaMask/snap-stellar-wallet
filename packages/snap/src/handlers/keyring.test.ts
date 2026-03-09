import { KeyringEvent, KeyringRpcMethod } from '@metamask/keyring-api';
import {
  emitSnapKeyringEvent,
  handleKeyringRequest,
} from '@metamask/keyring-snap-sdk';
import type { JsonRpcRequest } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';

import { KeyringHandler, CreateAccountOptionsStruct } from './keyring';
import { KnownCaip2ChainId, KnownCaip19Id } from '../constants';
import { AccountService } from '../services/account/AccountService';
import { AccountsRepository } from '../services/account/AccountsRepository';
import { State } from '../services/state';
import { KeypairService } from '../services/wallet/KeypairService';
import {
  getBip32Entropy,
  getDefaultEntropySource,
  getSnapProvider,
} from '../utils';
import { mockBip32Node } from '../utils/__mocks__/fixtures';
import { logger } from '../utils/logger';

jest.mock('../utils/logger');
jest.mock('../utils/snap');
jest.mock('../utils/requestResponse', () => ({
  validateOrigin: jest.fn(),
}));
jest.mock('@metamask/keyring-snap-sdk', () => ({
  handleKeyringRequest: jest.fn(),
  emitSnapKeyringEvent: jest.fn(),
}));

describe('KeyringHandler', () => {
  let keyringHandler: KeyringHandler;

  const entropySourceId = 'entropy-source-1';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);
    jest.mocked(getDefaultEntropySource).mockResolvedValue(entropySourceId);

    const accountsRepository = new AccountsRepository(
      new State({
        encrypted: false,
        defaultState: {
          keyringAccounts: {},
        },
      }),
    );
    const accountService = new AccountService({
      logger,
      keypairService: new KeypairService({ logger }),
      accountsRepository,
    });
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
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.listAccounts()).rejects.toThrow(
        'Method not implemented.',
      );
    });
  });

  describe('getAccount', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.getAccount('1')).rejects.toThrow(
        'Method not implemented.',
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

    it('emits the account created event', async () => {
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
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.discoverAccounts?.(
          [KnownCaip2ChainId.Mainnet],
          'entropy-source-1',
          0,
        ),
      ).rejects.toThrow('Method not implemented.');
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
    it('throws `Method not implemented.` error', async () => {
      await expect(
        keyringHandler.resolveAccountAddress(KnownCaip2ChainId.Mainnet, {
          method: 'resolveAccountAddress',
          params: ['1'],
          id: '1',
          jsonrpc: '2.0',
        }),
      ).rejects.toThrow('Method not implemented.');
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
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.deleteAccount('1')).rejects.toThrow(
        'Method not implemented.',
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

  describe('setSelectedAccounts', () => {
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.setSelectedAccounts(['1'])).rejects.toThrow(
        'Method not implemented.',
      );
    });
  });
});

describe('CreateAccountOptionsStruct', () => {
  it.each([
    {},
    undefined,
    { index: 0 },
    { index: 1 },
    { entropySource: 'ulid-123', index: 0 },
  ])('accepts valid options', (options) => {
    expect(() => assert(options, CreateAccountOptionsStruct)).not.toThrow();
  });

  it.each([{ index: -1 }, { entropySource: 1, index: 0 }])(
    'rejects invalid options',
    (options) => {
      expect(() => assert(options, CreateAccountOptionsStruct)).toThrow(Error);
    },
  );
});
