import type { Keypair } from '@stellar/stellar-sdk';

import type { LoadedAccount } from './api';
import type { Transaction } from './Transaction';

/**
 * Stateful handle for a loaded Stellar account and optional signer. Created by
 */
export class Wallet {
  readonly #account: LoadedAccount;

  readonly #signer: Keypair | null;

  constructor(account: LoadedAccount, signer: Keypair | null) {
    this.#account = account;
    this.#signer = signer;
  }

  /**
   * The Stellar account address (public key); uses the signer if present, otherwise the account ID.
   *
   * @returns The account address string.
   */
  get address(): string {
    return this.#signer?.publicKey() ?? this.#account.accountId();
  }

  /**
   * The loaded account data.
   *
   * @returns The loaded account.
   */
  get account(): LoadedAccount {
    return this.#account;
  }

  /**
   * Signs the given transaction with this wallet's signer.
   *
   * @param tx - The transaction to sign.
   * @throws {Error} If no signer was provided when this wallet was created.
   */
  signTransaction(tx: Transaction): void {
    if (!this.#signer) {
      throw new Error('No signer found when signing transaction');
    }
    tx.getRaw().sign(this.#signer);
  }
}
