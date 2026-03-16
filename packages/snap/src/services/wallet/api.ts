/**
 * Minimal account shape used by the wallet layer for building and rebuilding transactions.
 * Implementations may wrap chain-specific account types (e.g. Stellar Horizon account).
 */
export type LoadedAccount = {
  /** The Stellar account address (public key). */
  accountId(): string;
  /** The current sequence number (used to set transaction source sequence). */
  sequenceNumber(): string;
};

/**
 * Interface for deriving a 32-byte seed from a derivation index and entropy source.
 * Used by {@link WalletService} to obtain keypair material without depending on a specific
 * derivation implementation (e.g. BIP-32).
 */
export type IDeriver = {
  /**
   * @param index - The derivation index for the account.
   * @param entropySource - The entropy source ID (e.g. from keyring).
   * @returns A Promise that resolves to the 32-byte seed for Ed25519 keypair derivation.
   */
  get32ByteSeed(index: number, entropySource: string): Promise<Uint8Array>;
};

/**
 * Interface for a Stellar asset.
 */
export type Asset = {
  /** The asset code. */
  code: string;
  /** The asset issuer. */
  issuer: string;
};
