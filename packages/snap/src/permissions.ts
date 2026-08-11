import { KeyringRpcMethod } from '@metamask/keyring-api';
import { KeyringSnapRpcMethod } from '@metamask/keyring-api/v2';

import { METAMASK_ORIGIN } from './constants';

const prodOrigins = ['https://portfolio.metamask.io'];
const allowedOrigins = prodOrigins;

/**
 * Dapp origins are connected to the snap, but the snap does not expose any
 * keyring method to them. The set is empty so every dapp call is rejected.
 */
const dappPermissions = new Set<string>([]);

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
  /**
   * Keyring API v1 method names, kept because consumers still call them.
   * Dropping them makes the client fail with an access restriction error on
   * initial load. The v2 dispatcher maps them onto `getAccountAssets` and
   * `getAccountTransactions`.
   */
  KeyringRpcMethod.ListAccountAssets,
  KeyringRpcMethod.ListAccountTransactions,
]);

export const originPermissions = new Map<string, Set<string>>([]);

for (const origin of allowedOrigins) {
  originPermissions.set(origin, dappPermissions);
}
originPermissions.set(METAMASK_ORIGIN, metamaskPermissions);
