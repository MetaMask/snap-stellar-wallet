import { ensureError } from '@metamask/utils';
import { Networks } from '@stellar/stellar-sdk';
import type { BigNumber } from 'bignumber.js';

import { KnownCaip2ChainId } from '../../api';
import { parseScValToNative } from '../transaction/xdrParser';

const StellarNetwork: Record<KnownCaip2ChainId, Networks> = {
  [KnownCaip2ChainId.Mainnet]: Networks.PUBLIC,
  [KnownCaip2ChainId.Testnet]: Networks.TESTNET,
};

/**
 * Returns the Stellar network passphrase for the given scope (e.g. for transaction building).
 *
 * @param caip2ChainId - The CAIP-2 chain ID.
 * @returns The Stellar Networks passphrase.
 * @throws {Error} If the scope is not supported.
 */
export function caip2ChainIdToNetwork(
  caip2ChainId: KnownCaip2ChainId,
): Networks {
  if (!(caip2ChainId in StellarNetwork)) {
    throw new Error(`Network not found for caip2ChainId: ${caip2ChainId}`);
  }
  return StellarNetwork[caip2ChainId];
}

/**
 * Resolves a Stellar network passphrase to the corresponding CAIP-2 chain ID.
 *
 * @param network - The network name or Stellar Networks enum value.
 * @returns The CAIP-2 chain ID for the network.
 * @throws {Error} If the network is not recognized.
 */
export function networkToCaip2ChainId(
  network: string | Networks,
): KnownCaip2ChainId {
  const networkValue =
    typeof network === 'string' ? (network as Networks) : network;
  const caip2ChainId = (
    Object.keys(StellarNetwork) as KnownCaip2ChainId[]
  ).find((key) => StellarNetwork[key] === networkValue);
  if (!caip2ChainId) {
    throw new Error(`Caip2ChainId not found for network: ${network}`);
  }
  return caip2ChainId;
}

/**
 * Normalizes a single Stellar multicall `exec` result cell to a non-negative {@link BigNumber}.
 *
 * @param value - Native value from `scValToNative` for one invocation result.
 * @returns Parsed balance, or `null` when the cell is missing or not a supported numeric shape.
 */
export function sep41MulticallCellToBalance(value: unknown): BigNumber | null {
  if (
    typeof value === 'bigint' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    try {
      return parseScValToNative(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Detects the error shape thrown by Soroban RPC `getAccount` / `getAccountEntry` when the account
 * ledger entry is missing (`Error` with message `Account not found: <G… address>`).
 *
 * @param error - Value caught from the RPC client.
 * @param accountAddress - Stellar account id that was requested.
 * @returns True when `error` matches the SDK missing-account message for this address.
 */
export function isAccountNotFoundError(
  error: unknown,
  accountAddress: string,
): boolean {
  return ensureError(error).message === `Account not found: ${accountAddress}`;
}
