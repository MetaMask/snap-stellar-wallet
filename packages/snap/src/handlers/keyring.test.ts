import { KeyringRpcMethod } from '@metamask/keyring-api';
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk';
import type { JsonRpcRequest } from '@metamask/snaps-sdk';

import { KeyringHandler } from './keyring';
import { KnownCaip2ChainId, KnownCaip19Id } from '../constants';
import { logger } from '../utils/logger';

jest.mock('../utils/logger');
jest.mock('../utils/requestResponse', () => ({
  validateOrigin: jest.fn(),
}));
jest.mock('@metamask/keyring-snap-sdk', () => ({
  handleKeyringRequest: jest.fn(),
}));

describe('KeyringHandler', () => {
  let keyringHandler: KeyringHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    keyringHandler = new KeyringHandler({ logger });
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
      handleKeyringRequestSpy.mockReturnThis();

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
    it('throws `Method not implemented.` error', async () => {
      await expect(keyringHandler.createAccount()).rejects.toThrow(
        'Method not implemented.',
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
