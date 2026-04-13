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
    const transactions = await this.#state.getKey<KeyringTransaction[]>(
      `${this.#stateKey}.${accountId}`,
    );

    return transactions ?? [];
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
