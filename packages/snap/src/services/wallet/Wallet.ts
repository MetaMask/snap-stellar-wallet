import { PrivateKeyEncoding } from '@metamask/keyring-api/v2';
import { bytesToHex } from '@metamask/utils';
import { base58 } from '@scure/base';
import { hash, type Keypair } from '@stellar/stellar-sdk';

import {
  ExportKeyException,
  SignAuthEntryException,
  SignMessageException,
  SignTransactionException,
  VerifyMessageException,
} from './exceptions';
import { bufferToUint8Array } from '../../utils/buffer';
import { isBase64 } from '../../utils/string';
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
   * @param message - The message to sign.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns The signature as a base64 or hex string.
   */
  signMessage(
    message: string | Uint8Array,
    encode: 'hex' | 'base64' = 'base64',
  ): string {
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
   * Exports the raw ed25519 secret seed for this wallet's signer.
   *
   * Returns raw key bytes, not the Stellar StrKey `S…` seed — the keyring V2
   * export contract only supports hex/base58 over raw bytes. `hexadecimal`
   * yields a `0x`-prefixed string; `base58` yields a base58 string.
   *
   * @param encoding - The private-key encoding (hexadecimal or base58).
   * @returns The encoded raw secret seed.
   * @throws {ExportKeyException} If the key cannot be exported (details are not exposed).
   */
  exportKey(encoding: PrivateKeyEncoding): string {
    try {
      const rawSeed = bufferToUint8Array(this.#signer.rawSecretKey());
      return encoding === PrivateKeyEncoding.Base58
        ? base58.encode(rawSeed)
        : bytesToHex(rawSeed);
    } catch {
      throw new ExportKeyException();
    }
  }

  /**
   * Verifies a given message using the Stellar Signed Message protocol.
   * Please see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md for more details.
   *
   * @param message - The message to verify.
   * @param signature - The base64 encoded signature to verify.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns `true` if the signature is valid for this signer's public key, `false` if it is not.
   * @throws {VerifyMessageException} If verification cannot be completed (details are not exposed).
   */
  verifyMessage(
    message: string | Uint8Array,
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

  #encodeMessage(message: string | Uint8Array): Uint8Array {
    const messagePrefix = 'Stellar Signed Message:\n';
    let messageBuffer: Uint8Array;
    if (typeof message === 'string' && isBase64(message)) {
      messageBuffer = bufferToUint8Array(message, 'base64');
    } else if (typeof message === 'string') {
      messageBuffer = bufferToUint8Array(message, 'utf8');
    } else {
      messageBuffer = message;
    }
    return new Uint8Array([
      ...bufferToUint8Array(messagePrefix),
      ...messageBuffer,
    ]);
  }
}
