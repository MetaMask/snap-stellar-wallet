import { assert, StructError } from '@metamask/superstruct';

import {
  ChangeTrustOptJsonRpcRequestStruct,
  ChangeTrustOptJsonRpcResponseStruct,
  GetStellarAccountActivationStatusJsonRpcRequestStruct,
  GetStellarAccountActivationStatusJsonRpcResponseStruct,
  JsonRpcRequestWithAccountStruct,
} from './api';

const accountId = '11111111-1111-4111-8111-111111111111';
const scope = 'stellar:testnet';
const assetId =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

describe('JsonRpcRequestWithAccountStruct', () => {
  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'anyMethod',
      params: { accountId },
    },
    {
      jsonrpc: '2.0' as const,
      id: null,
      method: 'foo',
      params: { accountId, extra: 'allowed' },
    },
  ])(
    'accepts a JSON-RPC request whose params include a valid accountId',
    (request) => {
      expect(() =>
        assert(request, JsonRpcRequestWithAccountStruct),
      ).not.toThrow();
    },
  );

  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'anyMethod',
      params: { accountId: 'not-a-uuid' },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'anyMethod',
      params: {},
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'anyMethod',
    },
  ])(
    'rejects a JSON-RPC request without a valid params.accountId',
    (request) => {
      expect(() => assert(request, JsonRpcRequestWithAccountStruct)).toThrow(
        StructError,
      );
    },
  );
});

describe('ChangeTrustOptJsonRpcResponseStruct', () => {
  it.each([
    { status: true },
    { status: false },
    { status: true, transactionId: 'dGVzdA==' },
  ])('accepts a valid changeTrustOpt JSON-RPC response', (response) => {
    expect(() =>
      assert(response, ChangeTrustOptJsonRpcResponseStruct),
    ).not.toThrow();
  });

  it.each([
    {},
    { status: 'yes' },
    { status: true, transactionId: 'not-base64!!!' },
  ])('rejects an invalid changeTrustOpt JSON-RPC response', (response) => {
    expect(() => assert(response, ChangeTrustOptJsonRpcResponseStruct)).toThrow(
      StructError,
    );
  });
});

describe('ChangeTrustOptJsonRpcRequestStruct', () => {
  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope,
        assetId,
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope,
        assetId,
        action: 'add',
        limit: '1.5',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope,
        assetId,
        action: 'delete',
      },
    },
  ])('accepts valid changeTrustOpt JSON-RPC requests', (request) => {
    expect(() =>
      assert(request, ChangeTrustOptJsonRpcRequestStruct),
    ).not.toThrow();
  });

  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'wrongMethod',
      params: {
        accountId,
        scope,
        assetId,
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope: 'stellar:invalid',
        assetId,
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope,
        assetId: 'stellar:testnet/asset:USDC-INVALID',
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope: 'stellar:pubnet',
        assetId,
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope,
        assetId,
        action: 'delete',
        limit: '1',
      },
    },
  ])('rejects invalid changeTrustOpt JSON-RPC requests', (request) => {
    expect(() => assert(request, ChangeTrustOptJsonRpcRequestStruct)).toThrow(
      StructError,
    );
  });

  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope: 'stellar:pubnet',
        assetId,
        action: 'add',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'changeTrustOpt',
      params: {
        accountId,
        scope: 'stellar:pubnet',
        assetId,
        action: 'delete',
        limit: '0',
      },
    },
  ])('rejects requests when assetId chain does not match scope', (request) => {
    expect(() => assert(request, ChangeTrustOptJsonRpcRequestStruct)).toThrow(
      StructError,
    );
  });
});

describe('GetStellarAccountActivationStatusJsonRpcRequestStruct', () => {
  it('accepts a valid getStellarAccountActivationStatus JSON-RPC request', () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'getStellarAccountActivationStatus',
      params: {
        accountId,
        scope,
      },
    };

    expect(() =>
      assert(request, GetStellarAccountActivationStatusJsonRpcRequestStruct),
    ).not.toThrow();
  });

  it.each([
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'wrongMethod',
      params: {
        accountId,
        scope,
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'getStellarAccountActivationStatus',
      params: {
        accountId,
        scope: 'stellar:unknown',
      },
    },
    {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'getStellarAccountActivationStatus',
      params: {
        accountId: 'invalid-account-id',
        scope,
      },
    },
  ])(
    'rejects an invalid getStellarAccountActivationStatus JSON-RPC request',
    (request) => {
      expect(() =>
        assert(request, GetStellarAccountActivationStatusJsonRpcRequestStruct),
      ).toThrow(StructError);
    },
  );
});

describe('GetStellarAccountActivationStatusJsonRpcResponseStruct', () => {
  it.each([{ activated: true }, { activated: false }])(
    'accepts a valid getStellarAccountActivationStatus JSON-RPC response',
    (response) => {
      expect(() =>
        assert(
          response,
          GetStellarAccountActivationStatusJsonRpcResponseStruct,
        ),
      ).not.toThrow();
    },
  );

  it.each([{ activated: 'true' }, {}, { status: true }])(
    'rejects an invalid getStellarAccountActivationStatus JSON-RPC response',
    (response) => {
      expect(() =>
        assert(
          response,
          GetStellarAccountActivationStatusJsonRpcResponseStruct,
        ),
      ).toThrow(StructError);
    },
  );
});
