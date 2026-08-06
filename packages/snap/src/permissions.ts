import { KeyringSnapRpcMethod } from '@metamask/keyring-api/v2';

import { Environment } from './api';
import { AppConfig } from './config';
import { METAMASK_ORIGIN } from './constants';

const isDev = AppConfig.environment !== Environment.Production;

const prodOrigins = ['https://portfolio.metamask.io'];
const allowedOrigins = isDev ? ['http://localhost:3000'] : prodOrigins;

const dappPermissions = isDev
  ? new Set<string>([
      KeyringSnapRpcMethod.GetAccounts,
      KeyringSnapRpcMethod.GetAccount,
      KeyringSnapRpcMethod.DeleteAccount,
      KeyringSnapRpcMethod.GetAccountBalances,
      KeyringSnapRpcMethod.SubmitRequest,
      KeyringSnapRpcMethod.GetAccountTransactions,
      KeyringSnapRpcMethod.GetAccountAssets,
    ])
  : new Set<string>([]);

const metamaskPermissions = new Set([
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
]);

const metamask = METAMASK_ORIGIN;

export const originPermissions = new Map<string, Set<string>>([]);

for (const origin of allowedOrigins) {
  originPermissions.set(origin, dappPermissions);
}
originPermissions.set(metamask, metamaskPermissions);
