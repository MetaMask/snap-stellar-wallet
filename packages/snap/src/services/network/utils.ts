import { ensureError } from '@metamask/utils';
import type { xdr } from '@stellar/stellar-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { KnownCaip2ChainId } from '../../api';

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
 * Extracts asset data from a contract data entry.
 *
 * @param contractData - The contract data entry.
 * @param contractAddress - Token contract id strkey (`C…`) for error context and wasm token `assetRef`.
 * @returns The asset data.
 */
export function extractAssetDataFromContractData(
  contractData: xdr.ContractDataEntry,
  contractAddress: string,
): {
  name: string;
  symbol: string;
  decimals: number;
  isStellarClassicAsset: boolean;
} {
  try {
    const contractDataInstance = contractData.val().instance();

    // contractDataName is either contractExecutableWasm or contractExecutableStellarAsset
    // contractExecutableWasm: Wasm contract
    // contractExecutableStellarAsset: Stellar asset contract
    const contractDataName = contractDataInstance.executable().switch().name;

    const isStellarClassicAsset =
      contractDataName === 'contractExecutableStellarAsset';

    const assetData = {
      symbol: '',
      decimals: -1,
      name: '',
      isStellarClassicAsset,
    };

    // it is possible to have empty storage, such as when the contract is not a token contract
    for (const entry of contractDataInstance?.storage() ?? []) {
      const key = entry.key();
      const keyName = key.switch().name;

      if (keyName !== 'scvSymbol' || key.sym().toString() !== 'METADATA') {
        continue;
      }

      for (const mapEntry of entry.val().map() ?? []) {
        const fieldName = mapEntry.key().sym().toString();
        const value = mapEntry.val();

        switch (fieldName) {
          case 'name':
            // if it is a Stellar asset contract, the name is ${ASSET_CODE}:${ASSET_ISSUER}
            // if it is a Wasm contract, the name is the token name (e.g. "USDC")
            assetData.name = isStellarClassicAsset
              ? value.str().toString()
              : contractAddress;
            break;
          case 'symbol':
            assetData.symbol = value.str().toString();
            break;
          case 'decimal':
            assetData.decimals = value.u32();
            break;
          default:
            break;
        }
      }
    }
    if (assetData.name === '') {
      throw new Error(`Name is empty for contract ${contractAddress}`);
    }
    if (assetData.symbol === '') {
      throw new Error(`Symbol is empty for contract ${contractAddress}`);
    }
    if (assetData.decimals === -1) {
      throw new Error(`Decimals is empty for contract ${contractAddress}`);
    }

    return assetData;
  } catch {
    throw new Error(
      `Error extracting asset data from contract ${contractAddress}`,
    );
  }
}

/**
 * Parses a XDR value from a string, bigint, or number.
 *
 * @param value - The value to parse.
 * @returns The parsed amount in BigNumber.
 * @throws {Error} If the value is not a valid native value.
 */
export function parseScValToNative(value: string | bigint | number): BigNumber {
  let amountStr: string;
  if (typeof value === 'bigint') {
    amountStr = value.toString();
  } else if (typeof value === 'number') {
    amountStr = String(Math.trunc(value));
  } else {
    amountStr = String(value);
  }
  const amountBn = new BigNumber(amountStr);
  if (!amountBn.isFinite() || amountBn.isNegative()) {
    throw new Error(`Invalid native value: ${value}`);
  }
  return amountBn;
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
