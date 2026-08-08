import { KeyringSnapRpcMethod } from '@metamask/keyring-api/v2';
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
import { METAMASK_ORIGIN } from '../constants';

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
    KeyringSnapRpcMethod.GetAccounts,
    KeyringSnapRpcMethod.GetAccount,
    KeyringSnapRpcMethod.DeleteAccount,
    KeyringSnapRpcMethod.GetAccountBalances,
    KeyringSnapRpcMethod.SubmitRequest,
    KeyringSnapRpcMethod.GetAccountTransactions,
    KeyringSnapRpcMethod.GetAccountAssets,
  ])('allows method %s for allowed dapps', (method) => {
    const origin = 'http://localhost:3000';

    expect(() => validateOrigin(origin, method)).not.toThrow();
  });

  it('rejects createAccounts for dapps', () => {
    expect(() =>
      validateOrigin(
        'http://localhost:3000',
        KeyringSnapRpcMethod.CreateAccounts,
      ),
    ).toThrow(UnauthorizedError);
  });

  it.each([
    KeyringSnapRpcMethod.GetAccounts,
    KeyringSnapRpcMethod.GetAccount,
    KeyringSnapRpcMethod.CreateAccounts,
    KeyringSnapRpcMethod.DeleteAccount,
    KeyringSnapRpcMethod.GetAccountBalances,
    KeyringSnapRpcMethod.SubmitRequest,
    KeyringSnapRpcMethod.GetAccountTransactions,
    KeyringSnapRpcMethod.GetAccountAssets,
    KeyringSnapRpcMethod.ResolveAccountAddress,
    KeyringSnapRpcMethod.SetSelectedAccounts,
  ])('allows method %s for metamask', (method) => {
    const origin = METAMASK_ORIGIN;

    expect(() => validateOrigin(origin, method)).not.toThrow();
  });

  it.each(['invalid', undefined, '', null])(
    'rejects unauthorized origin %s',
    (origin) => {
      expect(() =>
        validateOrigin(origin as string, KeyringSnapRpcMethod.GetAccounts),
      ).toThrow(UnauthorizedError);
    },
  );
});
