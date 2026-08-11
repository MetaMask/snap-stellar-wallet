import { hash } from '@stellar/stellar-sdk';
import type { Keypair } from '@stellar/stellar-sdk';

import {
  SignAuthEntryException,
  SignMessageException,
  SignTransactionException,
  VerifyMessageException,
} from './exceptions';
import { bufferToUint8Array } from '../../utils/buffer';
import type { Transaction } from '../transaction/Transaction';

/**
 * Signing-only handle: Stellar SDK keypair for transaction and SEP-53 message signing.
 */
export class Wallet {
  readonly #signer: Keypair;

  constructor(signer: Keypair) {
    this.#signer = signer;
  }

  /**
   * The Stellar account address (signer's public key).
   *
   * @returns Public key string (`G…`).
   */
  get address(): string {
    return this.#signer.publicKey();
  }

  /**
   * Signs the given transaction with this wallet's signer.
   *
   * @param tx - The transaction to sign.
   * @throws {SignTransactionException} If Stellar SDK signing fails (details are not exposed).
   */
  signTransaction(tx: Transaction): void {
    try {
      // Allow to sign any transaction even if it is not initiated by this wallet
      tx.getRaw().sign(this.#signer);
    } catch {
      throw new SignTransactionException();
    }
  }

  /**
   * Signs a given message using the Stellar Signed Message protocol.
   * Please see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md for more details.
   *
   * The message is encoded as UTF-8 before hashing and signing.
   *
   * @param message - The UTF-8 message to sign.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns The signature as a base64 or hex string.
   */
  signMessage(message: string, encode: 'hex' | 'base64' = 'base64'): string {
    try {
      const messageBuffer = this.#encodeMessage(message);

      const signature = this.#signer
        .sign(hash(bufferToUint8Array(messageBuffer)))
        .toString(encode);

      return signature;
    } catch {
      throw new SignMessageException();
    }
  }

  /**
   * Verifies a given message using the Stellar Signed Message protocol.
   * Please see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md for more details.
   *
   * @param message - The UTF-8 message to verify.
   * @param signature - The base64 encoded signature to verify.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns `true` if the signature is valid for this signer's public key, `false` if it is not.
   * @throws {VerifyMessageException} If verification cannot be completed (details are not exposed).
   */
  verifyMessage(
    message: string,
    signature: string,
    encode: 'hex' | 'base64' = 'base64',
  ): boolean {
    try {
      const messageBuffer = this.#encodeMessage(message);

      const verified = this.#signer.verify(
        hash(bufferToUint8Array(messageBuffer)),
        bufferToUint8Array(signature, encode),
      );

      return verified;
    } catch {
      throw new VerifyMessageException();
    }
  }

  /**
   * Signs a SEP-43 Soroban auth entry preimage. The dapp passes the
   * `HashIdPreimage` (envelopeTypeSorobanAuthorization) as base64 XDR — the
   * wallet hashes the bytes with SHA-256 and signs the digest. No
   * "Stellar Signed Message" prefix is applied: the network ID is already
   * embedded inside the preimage.
   *
   * @param authEntry - The base64-encoded XDR `HashIdPreimage` to sign.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns The signature.
   * @throws {SignAuthEntryException} If signing fails (details are not exposed).
   * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
   */
  signAuthEntry(
    authEntry: string,
    encode: 'hex' | 'base64' = 'base64',
  ): string {
    try {
      const preimageBuffer = bufferToUint8Array(authEntry, 'base64');

      const signature = this.#signer
        .sign(hash(preimageBuffer))
        .toString(encode);

      return signature;
    } catch {
      throw new SignAuthEntryException();
    }
  }

  /**
   * Builds the SEP-0053 signing payload: `"Stellar Signed Message:\n"` + UTF-8
   * message bytes.
   *
   * @param message - The UTF-8 message text.
   * @returns Prefixed byte sequence to hash and sign.
   * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
   */
  #encodeMessage(message: string): Uint8Array {
    const messagePrefix = 'Stellar Signed Message:\n';
    return new Uint8Array([
      ...bufferToUint8Array(messagePrefix),
      ...bufferToUint8Array(message, 'utf8'),
    ]);
  }
}
