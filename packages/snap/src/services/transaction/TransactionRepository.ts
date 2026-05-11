import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import sortBy from 'lodash/sortBy';
import uniqBy from 'lodash/uniqBy';

import type { State } from '../state/State';

export type TransactionStateValue = {
  transactions: Record<string, KeyringTransaction[]>;
};

export class TransactionRepository {
  readonly #state: State<TransactionStateValue>;

  readonly #stateKey = 'transactions';

  constructor(state: State<TransactionStateValue>) {
    this.#state = state;
  }

  async getAll(): Promise<KeyringTransaction[]> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    return Object.values(transactionsByAccount ?? {}).flat();
  }

  async findByAccountId(accountId: string): Promise<KeyringTransaction[]> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    return transactionsByAccount?.[accountId] ?? [];
  }

  /**
   * Finds a persisted keyring transaction by its id (Stellar transaction hash), searching all
   * accounts in snap state.
   *
   * @param txId - Transaction hash (`Transaction.id`).
   * @returns The matching transaction, or `undefined` when none is stored.
   */
  async findByTransactionId(
    txId: string,
  ): Promise<KeyringTransaction | undefined> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    for (const list of Object.values(transactionsByAccount ?? {})) {
      const found = list.find((t) => t.id === txId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Finds a persisted keyring transaction by hash among the given accounts.
   *
   * @param txId - Stellar transaction hash (keyring `Transaction.id`).
   * @param accountIds - Account ids to search (same order as the track job).
   * @returns The transaction when found; otherwise `undefined`.
   */
  async findByIdAmongAccounts(
    txId: string,
    accountIds: readonly string[],
  ): Promise<KeyringTransaction | undefined> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    for (const accountId of accountIds) {
      const list = transactionsByAccount?.[accountId] ?? [];
      const found = list.find((t) => t.id === txId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  async save(transaction: KeyringTransaction): Promise<void> {
    const transactions = await this.findByAccountId(transaction.account);

    await this.#state.setKey(
      `${this.#stateKey}.${transaction.account}`,
      this.#insertNewTransaction(transactions, transaction),
    );
  }

  async saveMany(transactions: KeyringTransaction[]): Promise<void> {
    // Optimize the state operations by reading and writing to the state only once
    await this.#state.update((state) => {
      // Safe guard: persisted state may omit `transactions` until first write
      if (!state[this.#stateKey]) {
        state[this.#stateKey] = {};
      }
      const allTransactionsByAccount = state[this.#stateKey];

      transactions.forEach((transaction) => {
        const accountId = transaction.account;
        const existing = allTransactionsByAccount[accountId] ?? [];
        state[this.#stateKey][accountId] = this.#insertNewTransaction(
          existing,
          transaction,
        );
      });

      return state;
    });
  }

  #insertNewTransaction(
    transactions: KeyringTransaction[],
    newTransaction: KeyringTransaction,
  ): KeyringTransaction[] {
    const merged = [newTransaction, ...transactions];
    return sortBy(uniqBy(merged, 'id'), (item) => -(item.timestamp ?? 0));
  }
}
