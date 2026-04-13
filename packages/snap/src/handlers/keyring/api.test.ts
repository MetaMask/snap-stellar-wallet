import { assert, StructError } from '@metamask/superstruct';

import {
  CreateAccountOptionsStruct,
  ResolveAccountAddressRequestStruct,
  DiscoverAccountsStruct,
  ListAccountTransactionsRequestStruct,
  MultichainMethod,
  MultichainMethodStruct,
  SignMessageRequestStruct,
  SignMessageResponseStruct,
  SignTransactionRequestStruct,
  SignTransactionResponseStruct,
} from './api';
import { KnownCaip2ChainId } from '../../api';
import type { StellarKeyringAccount } from '../../services/account';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/account.fixtures';

const mockAccounts = generateMockStellarKeyringAccounts(1, 'entropy-source-1');
const account = mockAccounts[0] as StellarKeyringAccount;
const keyringRequestId = '11111111-1111-4111-8111-111111111111';
const xdr = `AAAAAgAAAADjngeX0YTNoQ15A0xC83aMm/sDnXrmLF+apmXvdmkUugAAAGQAC3gAAAAAQQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAOZfkjSFZ31vI/Nx28cC6iAFWLWcPIvJhM2NVoxmfgVTAAAAAAAAAAAAmJaAAAAAAAAAAAA=`;

describe('MultichainMethodStruct', () => {
  it.each([MultichainMethod.SignMessage, MultichainMethod.SignTransaction])(
    'accepts a supported multichain method',
    (method) => {
      expect(() => assert(method, MultichainMethodStruct)).not.toThrow();
    },
  );

  it('rejects an unsupported method string', () => {
    expect(() => assert('eth_sendTransaction', MultichainMethodStruct)).toThrow(
      StructError,
    );
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

describe('SignMessageRequestStruct', () => {
  const validSignMessageRequest = {
    id: keyringRequestId,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: account.id,
    request: {
      method: MultichainMethod.SignMessage,
      params: { message: 'Hello, world!' },
    },
  };

  it('accepts a valid signMessage keyring request', () => {
    expect(() =>
      assert(validSignMessageRequest, SignMessageRequestStruct),
    ).not.toThrow();
  });

  it.each([
    {
      ...validSignMessageRequest,
      request: {
        method: MultichainMethod.SignTransaction,
        params: { message: 'Hello' },
      },
    },
    {
      ...validSignMessageRequest,
      request: {
        method: MultichainMethod.SignMessage,
        params: { message: '' },
      },
    },
    {
      ...validSignMessageRequest,
      account: 'not-a-uuid',
    },
    {
      ...validSignMessageRequest,
      scope: 'invalid:scope' as KnownCaip2ChainId,
    },
    {
      ...validSignMessageRequest,
      id: 'not-a-uuid',
    },
  ])('rejects an invalid signMessage request', (request) => {
    expect(() => assert(request, SignMessageRequestStruct)).toThrow(
      StructError,
    );
  });
});

describe('SignMessageResponseStruct', () => {
  it('accepts a nonempty base64 signature', () => {
    expect(() =>
      assert({ signature: btoa('signed') }, SignMessageResponseStruct),
    ).not.toThrow();
  });

  it.each([{ signature: '' }, { signature: 'not!!!valid-base64' }])(
    'rejects an invalid signMessage response',
    (response) => {
      expect(() => assert(response, SignMessageResponseStruct)).toThrow(
        StructError,
      );
    },
  );
});

describe('SignTransactionRequestStruct', () => {
  const validSignTransactionRequest = {
    id: keyringRequestId,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: account.id,
    request: {
      method: MultichainMethod.SignTransaction,
      params: { transaction: xdr },
    },
  };

  it('accepts a valid signTransaction keyring request', () => {
    expect(() =>
      assert(validSignTransactionRequest, SignTransactionRequestStruct),
    ).not.toThrow();
  });

  it.each([
    {
      ...validSignTransactionRequest,
      request: {
        method: MultichainMethod.SignMessage,
        params: { transaction: xdr },
      },
    },
    {
      ...validSignTransactionRequest,
      request: {
        method: MultichainMethod.SignTransaction,
        params: { transaction: 'not-valid-xdr' },
      },
    },
    {
      ...validSignTransactionRequest,
      account: 'not-a-uuid',
    },
  ])('rejects an invalid signTransaction request', (request) => {
    expect(() => assert(request, SignTransactionRequestStruct)).toThrow(
      StructError,
    );
  });
});

describe('SignTransactionResponseStruct', () => {
  it('accepts a signature that is valid transaction envelope XDR', () => {
    expect(() =>
      assert({ signature: xdr }, SignTransactionResponseStruct),
    ).not.toThrow();
  });

  it.each([{ signature: '' }, { signature: 'AAA=' }])(
    'rejects an invalid signTransaction response',
    (response) => {
      expect(() => assert(response, SignTransactionResponseStruct)).toThrow(
        StructError,
      );
    },
  );
});

describe('ListAccountTransactionsRequestStruct', () => {
  it('accepts a valid listAccountTransactions request', () => {
    const request = {
      accountId: account.id,
      pagination: { limit: 10, next: null },
    };
    expect(() =>
      assert(request, ListAccountTransactionsRequestStruct),
    ).not.toThrow();
  });

  it.each([
    {
      accountId: 'invalid-account-id',
      pagination: { limit: 10, next: null },
    },
    {
      accountId: account.id,
      pagination: { limit: 0, next: null },
    },
    {
      accountId: account.id,
      pagination: { limit: 10, next: 'invalid-transaction-id' },
    },
  ])('rejects an invalid listAccountTransactions request', (request) => {
    expect(() => assert(request, ListAccountTransactionsRequestStruct)).toThrow(
      StructError,
    );
  });
});
