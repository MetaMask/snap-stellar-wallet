import type { EntropySourceId } from '@metamask/keyring-api';
import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import { STELLAR_COIN_TYPE } from '../../constants';
import {
  createPrefixedLogger,
  type ILogger,
  sanitizeSensitiveError,
  getBip32Entropy,
} from '../../utils';

/** Stellar curve */
export const STELLAR_CURVE = 'ed25519';

/** Stellar derivation path */
/** example: m/44'/148'/0' */
export const STELLAR_DERIVATION_PATH = `m/44'/${STELLAR_COIN_TYPE}'`;

/** Stellar derivation path type */
export type StellarDerivationPath =
  `${typeof STELLAR_DERIVATION_PATH}/${string}`;

export class KeypairService {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeypairService]');
  }

  /**
   * Returns the Stellar derivation path for a given index.
   * Stellar uses the Ed25519 curve, hardened derivation (') is crucial for security.
   *
   * @param index - The index of the account to derive the key pair for.
   * @returns The derivation path in the format m/44'/148'/index'
   * @example m/44'/148'/0'
   */
  static getDerivationPath(index: number): StellarDerivationPath {
    return `${STELLAR_DERIVATION_PATH}/${index}'`;
  }

  /**
   * Derives a Stellar key pair from a given index and entropy source.
   *
   * @param params - The parameters for the key derivation.
   * @param params.index - The index of the account to derive the key pair for.
   * @param params.entropySource - The entropy source to use for key derivation.
   * @returns A Promise that resolves to the derivation path and address.
   * @throws An error if unable to derive the key pair.
   */
  async deriveAddress({
    index,
    entropySource,
  }: {
    index: number;
    entropySource: EntropySourceId;
  }): Promise<{
    derivationPath: StellarDerivationPath;
    address: string;
  }> {
    try {
      const derivationPath = KeypairService.getDerivationPath(index);

      this.#logger.log({ derivationPath }, 'Generating Stellar wallet');

      const path = derivationPath.split('/');
      // get the BIP44 coin type entropy from the snap service
      const node = await getBip32Entropy({
        entropySource,
        path,
        curve: STELLAR_CURVE,
      });

      if (!node.privateKey || !node.publicKey) {
        throw new Error('Unable to derive private key or public key');
      }

      // node.privateKey is a 66 length hex string with 0x prefix
      // hexToBytes removes the leading 0x prefix and returns a 32-byte Uint8Array
      const privateKeyBytes = hexToBytes(node.privateKey);

      // Derive a stellar keypair from a seed, we use the SNAP provided private key as seed
      // Keypair.fromRawEd25519Seed requires a 32-byte Uint8Array as seed
      const keypair = Keypair.fromRawEd25519Seed(privateKeyBytes as Buffer);
      // In Stellar, the address is the public key
      const address = keypair.publicKey();

      if (!address) {
        throw new Error('Unable to derive an address');
      }

      return {
        address,
        derivationPath,
      };
    } catch (error) {
      // Logging depends on the log level;
      // it won't output logs in production builds.
      this.#logger.debug({ error }, 'Error deriving address');
      // Sanitize errors to prevent leaking sensitive cryptographic information
      throw sanitizeSensitiveError(error as Error);
    }
  }
}
