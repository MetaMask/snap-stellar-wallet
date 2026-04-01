import { assert, StructError } from '@metamask/superstruct';

import {
  CreateAccountOptionsStruct,
  ResolveAccountAddressRequestStruct,
  DiscoverAccountsStruct,
} from './api';
import { KnownCaip2ChainId, MultichainMethod } from '../../api';
import type { StellarKeyringAccount } from '../../services/account';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/fixtures';

const mockAccounts = generateMockStellarKeyringAccounts(1, 'entropy-source-1');
const account = mockAccounts[0] as StellarKeyringAccount;

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
      expect(() => assert(options, CreateAccountOptionsStruct)).toThrow(
        StructError,
      );
    },
  );
});

describe('ResolveAccountAddressRequestStruct', () => {
  it.each([
    // Test case: SignMessage are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: MultichainMethod.SignMessage,
      params: { address: account.address },
    },
    // Test case: SignTransaction are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: MultichainMethod.SignTransaction,
      params: { address: account.address },
    },
    // Test case: Additional Params are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: MultichainMethod.SignTransaction,
      params: { address: account.address, message: 'Hello, world!' },
    },
  ])(
    'accepts a valid resolveAccountAddressJsonRpcRequest request',
    (request) => {
      expect(() =>
        assert(
          {
            request,
            scope: KnownCaip2ChainId.Mainnet,
          },
          ResolveAccountAddressRequestStruct,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    {
      // Test case: Invalid method
      request: {
        jsonrpc: '2.0',
        id: '1',
        method: 'resolveAccountAddress',
        params: { address: account.address },
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
    // Test case: Missing JSON-RPC fields
    {
      request: {
        method: MultichainMethod.SignMessage,
        params: { address: account.address },
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
    // Test case: Invalid address
    {
      request: {
        jsonrpc: '2.0',
        id: '1',
        method: MultichainMethod.SignMessage,
        params: { address: 'invalid-address' },
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
    // Test case: Invalid params
    {
      request: {
        jsonrpc: '2.0',
        id: '1',
        method: MultichainMethod.SignMessage,
        params: 1,
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
  ])('rejects an invalid resolveAccountAddress request', (request) => {
    expect(() => assert(request, ResolveAccountAddressRequestStruct)).toThrow(
      StructError,
    );
  });
});

describe('DiscoverAccountsStruct', () => {
  it('accepts a valid discoverAccounts request', () => {
    const request = {
      scopes: [KnownCaip2ChainId.Mainnet],
      entropySource: 'entropy-source-1',
      groupIndex: 0,
    };
    expect(() => assert(request, DiscoverAccountsStruct)).not.toThrow();
  });

  it.each([
    {
      scopes: [KnownCaip2ChainId.Mainnet],
      entropySource: 'entropy-source-1',
      groupIndex: 1.5,
    },
    {
      scopes: [KnownCaip2ChainId.Mainnet],
      entropySource: 'entropy-source-1',
      groupIndex: -1,
    },
    {
      scopes: [KnownCaip2ChainId.Mainnet],
      entropySource: 'entropy-source-1',
      groupIndex: '0',
    },
    {
      scopes: 'invalid-chain-id' as KnownCaip2ChainId,
      entropySource: 'entropy-source-1',
      groupIndex: 0,
    },
  ])('rejects an invalid discoverAccounts request', (request) => {
    expect(() => assert(request, DiscoverAccountsStruct)).toThrow(StructError);
  });
});
