import { KeyringRpcMethod } from '@metamask/keyring-api';
import { KeyringRpcMethod as KeyringRpcMethodV2 } from '@metamask/keyring-api/v2';

import { Environment } from './api';
import { AppConfig } from './config';
import { METAMASK_ORIGIN } from './constants';

const isDev = AppConfig.environment !== Environment.Production;

const prodOrigins = ['https://portfolio.metamask.io'];
const allowedOrigins = isDev ? ['http://localhost:3000'] : prodOrigins;

const dappPermissions = isDev
  ? new Set<string>([
      // Keyring methods
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethodV2.GetAccount,
      KeyringRpcMethod.CreateAccount,
      KeyringRpcMethodV2.CreateAccounts,
      KeyringRpcMethodV2.DeleteAccount,
      KeyringRpcMethod.DiscoverAccounts,
      KeyringRpcMethod.GetAccountBalances,
      KeyringRpcMethodV2.SubmitRequest,
      KeyringRpcMethod.ListAccountTransactions,
      KeyringRpcMethod.ListAccountAssets,
      KeyringRpcMethodV2.GetAccounts,
    ])
  : new Set<string>([]);

const metamaskPermissions = new Set([
  // Keyring methods
  KeyringRpcMethod.ListAccounts,
  KeyringRpcMethodV2.GetAccount,
  KeyringRpcMethod.CreateAccount,
  KeyringRpcMethodV2.CreateAccounts,
  KeyringRpcMethodV2.DeleteAccount,
  KeyringRpcMethod.DiscoverAccounts,
  KeyringRpcMethod.GetAccountBalances,
  KeyringRpcMethodV2.SubmitRequest,
  KeyringRpcMethod.ListAccountTransactions,
  KeyringRpcMethod.ListAccountAssets,
  KeyringRpcMethod.ResolveAccountAddress,
  KeyringRpcMethod.SetSelectedAccounts,
  KeyringRpcMethodV2.GetAccounts,
  KeyringRpcMethodV2.ExportAccount,
]);

const metamask = METAMASK_ORIGIN;

export const originPermissions = new Map<string, Set<string>>([]);

for (const origin of allowedOrigins) {
  originPermissions.set(origin, dappPermissions);
}
originPermissions.set(metamask, metamaskPermissions);
