import { assert, StructError } from '@metamask/superstruct';
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder as StellarTransactionBuilder,
} from '@stellar/stellar-sdk';

import {
  ChangeTrustOptJsonRpcRequestStruct,
  ChangeTrustOptJsonRpcResponseStruct,
  ComputeFeeJsonRpcRequestStruct,
  JsonRpcRequestWithAccountStruct,
  SignAndSendTransactionJsonRpcRequestStruct,
  SignAndSendTransactionJsonRpcResponseStruct,
} from './api';

const accountId = '11111111-1111-4111-8111-111111111111';
const scope = 'stellar:testnet';
const assetId =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const sourceAddress =
  'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';

const buildTestInvokeXdr = () => {
  const contract = new Contract(
    'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT',
  );
  return new StellarTransactionBuilder(new Account(sourceAddress, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call('swap'))
    .setTimeout(60)
    .build()
    .toXDR();
};

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
    {
      status: true,
      transactionId:
        '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1',
    },
  ])('accepts a valid changeTrustOpt JSON-RPC response', (response) => {
    expect(() =>
      assert(response, ChangeTrustOptJsonRpcResponseStruct),
    ).not.toThrow();
  });

  it.each([{}, { status: 'yes' }, { status: true, transactionId: 'dGVzdA==' }])(
    'rejects an invalid changeTrustOpt JSON-RPC response',
    (response) => {
      expect(() =>
        assert(response, ChangeTrustOptJsonRpcResponseStruct),
      ).toThrow(StructError);
    },
  );
});

describe('SignAndSendTransactionJsonRpcResponseStruct', () => {
  it.each([
    {
      transactionId:
        '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1',
    },
    {
      transactionId:
        '7D4B0C5EF7498B223F45A10F461060FB64F53EB13CAF18E8DC7DE95A8CF9C0E1',
    },
  ])('accepts a valid signAndSendTransaction JSON-RPC response', (response) => {
    expect(() =>
      assert(response, SignAndSendTransactionJsonRpcResponseStruct),
    ).not.toThrow();
  });

  it.each([
    {},
    { transactionId: '' },
    { transactionId: 123 },
    { transactionId: 'dGVzdA==' },
    {
      transactionId:
        '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0',
    },
  ])(
    'rejects an invalid signAndSendTransaction JSON-RPC response',
    (response) => {
      expect(() =>
        assert(response, SignAndSendTransactionJsonRpcResponseStruct),
      ).toThrow(StructError);
    },
  );
});

describe('SignAndSendTransactionJsonRpcRequestStruct', () => {
  const transaction = buildTestInvokeXdr();

  it('accepts a valid signAndSendTransaction JSON-RPC request', () => {
    expect(() =>
      assert(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'signAndSendTransaction',
          params: {
            accountId,
            scope,
            transaction,
            options: {
              type: 'swap',
            },
          },
        },
        SignAndSendTransactionJsonRpcRequestStruct,
      ),
    ).not.toThrow();
  });

  it('accepts an empty transaction type', () => {
    expect(() =>
      assert(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'signAndSendTransaction',
          params: {
            accountId,
            scope,
            transaction,
            options: {
              type: '',
            },
          },
        },
        SignAndSendTransactionJsonRpcRequestStruct,
      ),
    ).not.toThrow();
  });

  it.each([
    { transaction: 'not-xdr', options: { type: 'swap' } },
    { transaction, options: { type: 'swap', visible: 'yes' } },
  ])(
    'rejects an invalid signAndSendTransaction JSON-RPC request',
    (overrides) => {
      expect(() =>
        assert(
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'signAndSendTransaction',
            params: {
              accountId,
              scope,
              ...overrides,
            },
          },
          SignAndSendTransactionJsonRpcRequestStruct,
        ),
      ).toThrow(StructError);
    },
  );
});

describe('ComputeFeeJsonRpcRequestStruct', () => {
  const transaction = buildTestInvokeXdr();

  it('accepts an empty transaction type', () => {
    expect(() =>
      assert(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'computeFee',
          params: {
            accountId,
            scope,
            transaction,
            options: {
              type: '',
            },
          },
        },
        ComputeFeeJsonRpcRequestStruct,
      ),
    ).not.toThrow();
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
