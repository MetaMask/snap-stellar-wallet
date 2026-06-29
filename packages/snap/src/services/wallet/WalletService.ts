import type { JsonSLIP10Node } from '@metamask/key-tree';
import { SLIP10Node } from '@metamask/key-tree';
import { hexToBytes } from '@metamask/utils';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';

import type { StellarKeyringAccount } from '../account';
import { KeyDerivationException } from './exceptions';
import { getDerivationPath } from './utils';
import { Wallet } from './Wallet';
import { STELLAR_CURVE } from '../../constants';
import {
  bufferToUint8Array,
  getBip32Entropy,
  rethrowIfInstanceElseThrow,
} from '../../utils';
import { assertSameAddress } from '../account/utils';

type Slip10KeyMaterial = {
  privateKey?: string;
  publicKey?: string;
};

/**
 * Derives Stellar signing material from keyring entropy.
 * Network / on-chain account access lives in {@link OnChainAccountService} and {@link NetworkService}.
 */
export class WalletService {
  /**
   * Derives a Stellar address (public key) from the given entropy source and derivation index.
   *
   * @param params - Options object.
   * @param params.index - The derivation index for the account.
   * @param params.entropySource - Entropy source ID (e.g. from keyring).
   * @returns A Promise that resolves to the derived address (public key string).
   * @throws {KeyDerivationException} If keypair derivation fails.
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
   * @throws {KeyDerivationException} If keypair derivation fails.
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

  /**
   * Gets a wallet resolver function that resolves to a Wallet for the given index.
   *
   * @param entropySource - The entropy source to use for derivation.
   * @returns A function that resolves to a Wallet for the given index.
   * @throws {KeyDerivationException} If keypair derivation fails.
   */
  async getWalletResolver(
    entropySource: string,
  ): Promise<(index: number) => Promise<Wallet>> {
    const coinTypeNode = await this.#getRootNode(entropySource);
    return async (index: number) => {
      const keypair = await this.#deriveKeypairBySlip10Node(
        coinTypeNode,
        index,
      );
      return new Wallet(keypair);
    };
  }

  async #deriveKeypair({
    index,
    entropySource,
  }: {
    index: number;
    entropySource: string;
  }): Promise<StellarKeypair> {
    try {
      const jsonNode = await this.#getJsonNodeByEntropy(entropySource, index);

      this.#assertNodeHasPrivateAndPublicKey(jsonNode);

      return this.#stellarFromRawEd25519Seed(jsonNode.privateKey);
    } catch (error: unknown) {
      return rethrowIfInstanceElseThrow(
        error,
        [KeyDerivationException],
        new KeyDerivationException('Unable to derive keypair from entropy'),
      );
    }
  }

  async #getRootNode(entropySource: string): Promise<SLIP10Node> {
    try {
      const jsonNode = await this.#getJsonNodeByEntropy(entropySource);
      const coinTypeNode = await SLIP10Node.fromJSON(jsonNode);
      return coinTypeNode;
    } catch (error: unknown) {
      return rethrowIfInstanceElseThrow(
        error,
        [KeyDerivationException],
        new KeyDerivationException('Unable to load coin-type derivation node'),
      );
    }
  }

  async #deriveKeypairBySlip10Node(
    node: SLIP10Node,
    index: number,
  ): Promise<StellarKeypair> {
    try {
      const derivedNode = await node.derive([`slip10:${index}'`]);

      this.#assertNodeHasPrivateAndPublicKey(derivedNode);

      return this.#stellarFromRawEd25519Seed(derivedNode.privateKey);
    } catch (error: unknown) {
      return rethrowIfInstanceElseThrow(
        error,
        [KeyDerivationException],
        new KeyDerivationException('Unable to derive keypair at account index'),
      );
    }
  }

  async #getJsonNodeByEntropy(
    entropySource: string,
    index?: number,
  ): Promise<JsonSLIP10Node> {
    // getBip32Entropy already wrapped in a StellarSnapException
    return getBip32Entropy({
      entropySource,
      path: this.#getDerivationPath(index),
      curve: STELLAR_CURVE,
    });
  }

  #getDerivationPath(index?: number): string[] {
    return getDerivationPath(index).split('/');
  }

  #assertNodeHasPrivateAndPublicKey(
    node: Slip10KeyMaterial,
  ): asserts node is Slip10KeyMaterial & {
    privateKey: string;
    publicKey: string;
  } {
    if (!node.privateKey || !node.publicKey) {
      throw new KeyDerivationException('Derived node is missing key material');
    }
  }

  #stellarFromRawEd25519Seed(privateKeyHex: string): StellarKeypair {
    try {
      const privateKeyBytes = hexToBytes(privateKeyHex);
      return StellarKeypair.fromRawEd25519Seed(
        bufferToUint8Array(privateKeyBytes),
      );
    } catch {
      throw new KeyDerivationException(
        'Unable to build Stellar keypair from derived material',
      );
    }
  }
}
