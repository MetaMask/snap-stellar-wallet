import { assert, StructError } from '@metamask/superstruct';

import {
  StellarAddressStruct,
  CreateAccountOptionsStruct,
  CaipChainIdStruct,
  ResolveAccountAddressRequestStruct,
  StellarMultichainMethod,
  DiscoverAccountsStruct,
} from './types';
import { KnownCaip2ChainId } from '../../constants';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/fixtures';
import type { StellarKeyringAccount } from '../../services/account/AccountsRepository';

const mockAccounts = generateMockStellarKeyringAccounts(1, 'entropy-source-1');
const account = mockAccounts[0] as StellarKeyringAccount;

describe('StellarAddressStruct', () => {
  it('accepts a valid Stellar address', () => {
    const { address } = account;
    expect(() => assert(address, StellarAddressStruct)).not.toThrow();
  });

  it('rejects an invalid Stellar address', () => {
    const address = 'invalid-address';
    expect(() => assert(address, StellarAddressStruct)).toThrow(StructError);
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
      expect(() => assert(options, CreateAccountOptionsStruct)).toThrow(
        StructError,
      );
    },
  );
});

describe('CaipChainIdStruct', () => {
  it.each([KnownCaip2ChainId.Mainnet, KnownCaip2ChainId.Testnet])(
    'accepts valid chain ID',
    (chainId) => {
      expect(() => assert(chainId, CaipChainIdStruct)).not.toThrow();
    },
  );

  it('rejects an invalid chain ID', () => {
    const chainId = 'invalid-chain-id';
    expect(() => assert(chainId, CaipChainIdStruct)).toThrow(StructError);
  });
});

describe('ResolveAccountAddressRequestStruct', () => {
  it.each([
    // Test case: SignMessage are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: StellarMultichainMethod.SignMessage,
      params: { address: account.address },
    },
    // Test case: SignTransaction are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: StellarMultichainMethod.SignTransaction,
      params: { address: account.address },
    },
    // Test case: Additional Params are allowed
    {
      jsonrpc: '2.0',
      id: '1',
      method: StellarMultichainMethod.SignTransaction,
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
        method: StellarMultichainMethod.SignMessage,
        params: { address: account.address },
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
    // Test case: Invalid address
    {
      request: {
        jsonrpc: '2.0',
        id: '1',
        method: StellarMultichainMethod.SignMessage,
        params: { address: 'invalid-address' },
      },
      scope: KnownCaip2ChainId.Mainnet,
    },
    // Test case: Invalid params
    {
      request: {
        jsonrpc: '2.0',
        id: '1',
        method: StellarMultichainMethod.SignMessage,
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
