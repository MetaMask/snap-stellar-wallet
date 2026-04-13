import type { StellarDerivationPath } from './api';
import { STELLAR_DERIVATION_PATH_PREFIX } from '../../constants';

/**
 * Returns the Stellar BIP32 derivation path for the given index (e.g. `m/44'/148'/0'`).
 *
 * @param index - The derivation index (account number).
 * @returns The derivation path string.
 */
export function getDerivationPath(index: number): StellarDerivationPath {
  return `${STELLAR_DERIVATION_PATH_PREFIX}/${index}'`;
}
