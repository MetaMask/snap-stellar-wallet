import type { KeyringAccount, EntropySourceId } from '@metamask/keyring-api';

/** Stellar derivation path type (e.g. `m/44'/148'/0'`). */
export type StellarDerivationPath = `m/44'/148'/${string}'`;

/** Keyring account extended with Stellar-specific derivation fields. */
export type StellarKeyringAccount = KeyringAccount & {
  entropySource: EntropySourceId;
  derivationPath: StellarDerivationPath;
  index: number;
};
