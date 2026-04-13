import { sha256 } from '@metamask/utils';
import type { Keypair } from '@stellar/stellar-sdk';

import {
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
   * @returns A promise that resolves to the signature as a base64 or hex string.
   */
  async signMessage(
    message: string | Uint8Array,
    encode: 'hex' | 'base64' = 'base64',
  ): Promise<string> {
    try {
      const messageBuffer = this.#encodeMessage(message);

      const messageHash = await sha256(messageBuffer);

      const signature = this.#signer
        .sign(bufferToUint8Array(messageHash))
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
   * @param message - The message to verify.
   * @param signature - The base64 encoded signature to verify.
   * @param encode - The encoding to use for the signature. Defaults to 'base64'.
   * @returns `true` if the signature is valid for this signer's public key, `false` if it is not.
   * @throws {VerifyMessageException} If verification cannot be completed (details are not exposed).
   */
  async verifyMessage(
    message: string | Uint8Array,
    signature: string,
    encode: 'hex' | 'base64' = 'base64',
  ): Promise<boolean> {
    try {
      const messageBuffer = this.#encodeMessage(message);

      const messageHash = await sha256(messageBuffer);

      const verified = this.#signer.verify(
        bufferToUint8Array(messageHash),
        bufferToUint8Array(signature, encode),
      );

      return verified;
    } catch {
      throw new VerifyMessageException();
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
