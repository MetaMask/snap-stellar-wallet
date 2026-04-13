import { hexToBytes } from '@metamask/utils';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';

import type { StellarKeyringAccount } from '../account';
import { WalletServiceException } from './exceptions';
import { getDerivationPath } from './utils';
import { Wallet } from './Wallet';
import { STELLAR_CURVE } from '../../constants';
import {
  createPrefixedLogger,
  bufferToUint8Array,
  getBip32Entropy,
  sanitizeSensitiveError,
} from '../../utils';
import type { ILogger } from '../../utils';
import { assertSameAddress } from '../account/utils';

/**
 * Derives Stellar signing material from keyring entropy.
 * Network / on-chain account access lives in {@link OnChainAccountService} and {@link NetworkService}.
 */
export class WalletService {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[💼 WalletService]');
  }

  /**
   * Derives a Stellar address (public key) from the given entropy source and derivation index.
   *
   * @param params - Options object.
   * @param params.index - The derivation index for the account.
   * @param params.entropySource - Entropy source ID (e.g. from keyring).
   * @returns A Promise that resolves to the derived address (public key string).
   * @throws {WalletServiceException} If keypair derivation fails.
   */
  async deriveAddress(params: {
    index: number;
    entropySource: string;
  }): Promise<string> {
    const { index, entropySource } = params;
    const keypair = await this.#deriveKeypair({ index, entropySource });
    return keypair.publicKey();
  }

  /**
   * Builds a signing {@link Wallet} for a keyring row; verifies derived public key matches stored address.
   *
   * @param account - Keyring account (entropy source + index + expected address).
   * @returns A promise that resolves to the signing wallet.
   * @throws {WalletServiceException} If keypair derivation fails.
   * @throws When derived public key does not match the keyring address (`DerivedAccountAddressMismatchException`).
   */
  async resolveWallet(account: StellarKeyringAccount): Promise<Wallet> {
    const keypair = await this.#deriveKeypair({
      index: account.index,
      entropySource: account.entropySource,
    });
    assertSameAddress(account.address, keypair.publicKey());
    return new Wallet(keypair);
  }

  async #deriveKeypair({
    index,
    entropySource,
  }: {
    index: number;
    entropySource: string;
  }): Promise<StellarKeypair> {
    try {
      const seed = await this.#getSeed(index, entropySource);
      return StellarKeypair.fromRawEd25519Seed(bufferToUint8Array(seed));
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Error deriving keypair', error);
      throw new WalletServiceException('Failed to derive keypair');
    }
  }

  async #getSeed(index: number, entropySource: string): Promise<Uint8Array> {
    try {
      const derivationPath = getDerivationPath(index);
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
      this.#logger.logErrorWithDetails('Error getting seed', error);

      throw sanitizeSensitiveError(error as Error);
    }
  }
}
