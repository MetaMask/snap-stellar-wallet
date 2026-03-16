import type { Transaction as StellarTransaction } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

/**
 * Wrapper around a Stellar transaction. Exposes fee, operation count, and network passphrase
 * for callers.
 */
export class Transaction {
  readonly #inner: StellarTransaction;

  constructor(inner: StellarTransaction) {
    this.#inner = inner;
  }

  /**
   * The total fee for the transaction (in stroops).
   *
   * @returns The total fee as BigNumber.
   */
  getTotalFee(): BigNumber {
    return new BigNumber(this.#inner.fee);
  }

  /**
   * The number of operations in the transaction.
   *
   * @returns The operation count.
   */
  getOperationCount(): number {
    return this.#inner.operations.length;
  }

  /**
   * The network passphrase (e.g. for mainnet/testnet).
   *
   * @returns The network passphrase string.
   */
  getNetworkPassphrase(): string {
    return this.#inner.networkPassphrase;
  }

  /**
   * The raw SDK transaction. For use only within the wallet module (signing, sending).
   *
   * @returns The raw Stellar SDK transaction.
   * @internal
   */
  getRaw(): StellarTransaction {
    return this.#inner;
  }
}
