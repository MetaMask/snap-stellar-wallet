import type { KeyringAccount, EntropySourceId } from '@metamask/keyring-api';

export type KeyringAccountState = {
  keyringAccounts: Record<string, StellarKeyringAccount>;
};

/** Stellar BIP44 derivation path (e.g. `m/44'/148'/0'`). */
export type StellarDerivationPath = `m/44'/148'/${string}'`;

/** Keyring account extended with Stellar-specific derivation fields. */
export type StellarKeyringAccount = KeyringAccount & {
  entropySource: EntropySourceId;
  derivationPath: StellarDerivationPath;
  index: number;
};
