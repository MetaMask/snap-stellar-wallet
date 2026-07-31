import { KeyringRpcMethod } from '@metamask/keyring-api';
import { KeyringSnapRpcMethod } from '@metamask/keyring-api/v2';

import { Environment } from './api';
import { AppConfig } from './config';
import { METAMASK_ORIGIN } from './constants';

const isDev = AppConfig.environment !== Environment.Production;

const prodOrigins = ['https://portfolio.metamask.io'];
const allowedOrigins = isDev ? ['http://localhost:3000'] : prodOrigins;

const dappPermissions = isDev
  ? new Set<string>([
      // Keyring v2 methods
      KeyringSnapRpcMethod.GetAccounts,
      KeyringSnapRpcMethod.GetAccount,
      KeyringSnapRpcMethod.CreateAccounts,
      KeyringSnapRpcMethod.DeleteAccount,
      KeyringSnapRpcMethod.GetAccountBalances,
      KeyringSnapRpcMethod.SubmitRequest,
      KeyringSnapRpcMethod.GetAccountTransactions,
      KeyringSnapRpcMethod.GetAccountAssets,
      // Keyring v1 methods kept for backwards compatibility — callers using
      // old method names are still accepted by the permission layer.
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethod.CreateAccount,
      KeyringRpcMethod.FilterAccountChains,
      KeyringRpcMethod.DiscoverAccounts,
      KeyringRpcMethod.ListAccountTransactions,
      KeyringRpcMethod.ListAccountAssets,
    ])
  : new Set<string>([]);

const metamaskPermissions = new Set([
  // Keyring v2 methods
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
  // Keyring v1 methods kept for backwards compatibility — callers using
  // old method names are still accepted by the permission layer.
  KeyringRpcMethod.ListAccounts,
  KeyringRpcMethod.CreateAccount,
  KeyringRpcMethod.DiscoverAccounts,
  KeyringRpcMethod.ListAccountTransactions,
  KeyringRpcMethod.ListAccountAssets,
]);

const metamask = METAMASK_ORIGIN;

export const originPermissions = new Map<string, Set<string>>([]);

for (const origin of allowedOrigins) {
  originPermissions.set(origin, dappPermissions);
}
originPermissions.set(metamask, metamaskPermissions);
