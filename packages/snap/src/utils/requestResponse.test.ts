import { KeyringRpcMethod } from '@metamask/keyring-api';
import { KeyringSnapRpcMethod } from '@metamask/keyring-api/v2';
import {
  InvalidParamsError,
  SnapError,
  UnauthorizedError,
} from '@metamask/snaps-sdk';
import { string, object } from '@metamask/superstruct';

import { METAMASK_ORIGIN } from '../constants';
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
    KeyringSnapRpcMethod.GetAccounts,
    KeyringSnapRpcMethod.GetAccount,
    KeyringSnapRpcMethod.CreateAccounts,
    KeyringSnapRpcMethod.SubmitRequest,
  ])('rejects method %s for dapps', (method) => {
    expect(() => validateOrigin('http://localhost:3000', method)).toThrow(
      UnauthorizedError,
    );
  });

  it.each([
    KeyringSnapRpcMethod.GetAccounts,
    KeyringSnapRpcMethod.GetAccount,
    KeyringSnapRpcMethod.SubmitRequest,
    KeyringRpcMethod.ListAccountAssets,
  ])('rejects method %s for the connected dapp origin', (method) => {
    expect(() =>
      validateOrigin('https://portfolio.metamask.io', method),
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
