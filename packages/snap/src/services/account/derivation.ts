import { hexToBytes } from '@metamask/utils';

import { type StellarDerivationPath } from './api';
import { STELLAR_COIN_TYPE } from '../../api';
import {
  createPrefixedLogger,
  getBip32Entropy,
  type ILogger,
  sanitizeSensitiveError,
} from '../../utils';

const STELLAR_CURVE = 'ed25519';
/** Stellar BIP32 derivation path prefix. */
const STELLAR_DERIVATION_PATH_PREFIX = `m/44'/${STELLAR_COIN_TYPE}'`;
/**
 * Returns the Stellar BIP32 derivation path for the given index (e.g. `m/44'/148'/0'`).
 *
 * @param index - The derivation index (account number).
 * @returns The derivation path string.
 */
export function getDerivationPath(index: number): StellarDerivationPath {
  return `${STELLAR_DERIVATION_PATH_PREFIX}/${index}'`;
}

/**
 * Derives a 32-byte Ed25519 seed from the given index and entropy source using BIP32.
 * Used by WalletService for keypair derivation.
 *
 * @param index - The derivation index.
 * @param entropySource - The entropy source ID (e.g. from the keyring).
 * @param logger - Optional logger for derivation logs.
 * @returns A Promise that resolves to the 32-byte seed for Ed25519 keypair derivation.
 * @throws If derivation fails or the keyring does not return a valid key (errors are sanitized).
 */
export async function get32ByteSeed(
  index: number,
  entropySource: string,
  logger?: ILogger,
): Promise<Uint8Array> {
  try {
    const derivationPath = getDerivationPath(index);
    if (logger) {
      logger.log({ derivationPath }, 'Generating Stellar wallet');
    }
    const path = derivationPath.split('/');
    const node = await getBip32Entropy({
      entropySource,
      path,
      curve: STELLAR_CURVE,
    });
    if (!node.privateKey || !node.publicKey) {
      throw new Error('Unable to derive private key or public key');
    }
    const privateKeyBytes = hexToBytes(node.privateKey);
    return privateKeyBytes;
  } catch (error) {
    if (logger) {
      logger.debug({ error }, 'Error getting seed');
    }
    throw sanitizeSensitiveError(error as Error);
  }
}

/**
 * Creates an {@link IDeriver}-compatible object that derives Stellar seeds with prefixed logging.
 * Use when wiring WalletService in context.
 *
 * @param logger - Logger to use; a derivation-prefixed logger is created from it.
 * @returns An object with `get32ByteSeed(index, entropySource)` returning a Promise that resolves to the seed.
 */
export function createAccountDeriver(logger: ILogger): {
  get32ByteSeed: (index: number, entropySource: string) => Promise<Uint8Array>;
} {
  const prefixed = createPrefixedLogger(logger, '[🔑 AccountDeriver]');
  return {
    get32ByteSeed: async (index, entropySource) =>
      get32ByteSeed(index, entropySource, prefixed),
  };
}
