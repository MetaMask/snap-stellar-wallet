import { KeyringRpcMethod } from '@metamask/keyring-api';
import {
  InvalidParamsError,
  SnapError,
  UnauthorizedError,
} from '@metamask/snaps-sdk';
import { string, object } from '@metamask/superstruct';

import {
  validateRequest,
  validateResponse,
  validateOrigin,
} from './requestResponse';

const TestStruct = object({
  url: string(),
});

describe('validateRequest', () => {
  it('validates request parameters', () => {
    const requestParams = { url: 'https://example.com' };

    expect(() => validateRequest(requestParams, TestStruct)).not.toThrow();
  });

  it('rejects invalid request parameters', () => {
    const requestParams = { url: 123 };

    expect(() => validateRequest(requestParams, TestStruct)).toThrow(
      InvalidParamsError,
    );
  });
});

describe('validateResponse', () => {
  it('validates response', () => {
    const response = { url: 'https://example.com' };

    expect(() => validateResponse(response, TestStruct)).not.toThrow();
  });

  it('rejects invalid response', () => {
    const response = { url: 123 };

    expect(() => validateResponse(response, TestStruct)).toThrow(SnapError);
  });
});

describe('validateOrigin', () => {
  it.each([
    KeyringRpcMethod.ListAccounts,
    KeyringRpcMethod.GetAccount,
    KeyringRpcMethod.CreateAccount,
    KeyringRpcMethod.DeleteAccount,
    KeyringRpcMethod.DiscoverAccounts,
    KeyringRpcMethod.GetAccountBalances,
    KeyringRpcMethod.SubmitRequest,
    KeyringRpcMethod.ListAccountTransactions,
    KeyringRpcMethod.ListAccountAssets,
  ])('allows method %s for allowed dapps', (method) => {
    const origin = 'http://localhost:3000';

    expect(() => validateOrigin(origin, method)).not.toThrow();
  });

  it.each([
    KeyringRpcMethod.ListAccounts,
    KeyringRpcMethod.GetAccount,
    KeyringRpcMethod.CreateAccount,
    KeyringRpcMethod.DeleteAccount,
    KeyringRpcMethod.DiscoverAccounts,
    KeyringRpcMethod.GetAccountBalances,
    KeyringRpcMethod.SubmitRequest,
    KeyringRpcMethod.ListAccountTransactions,
    KeyringRpcMethod.ListAccountAssets,
    KeyringRpcMethod.ResolveAccountAddress,
    KeyringRpcMethod.SetSelectedAccounts,
  ])('allows method %s for metamask', (method) => {
    const origin = 'metamask';

    expect(() => validateOrigin(origin, method)).not.toThrow();
  });

  it.each(['invalid', undefined, '', null])(
    'rejects unauthorized origin %s',
    (origin) => {
      expect(() =>
        validateOrigin(origin as string, KeyringRpcMethod.ListAccounts),
      ).toThrow(UnauthorizedError);
    },
  );
});
