import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import { groupBy } from 'lodash';
import sortBy from 'lodash/sortBy';
import uniqBy from 'lodash/uniqBy';

import type { StellarKeyringTransaction } from './api';
import {
  isPendingTransactionStatus,
  shouldDropPendingTransaction,
  toKeyringTransactions,
} from './utils';
import type { KnownCaip2ChainId } from '../../api';
import type { State } from '../state/State';

export type TransactionStateValue = {
  transactions: Record<string, StellarKeyringTransaction[]>;
  lastScanTokens: Record<string, Record<KnownCaip2ChainId, string | null>>;
};

export class TransactionRepository {
  readonly #state: State<TransactionStateValue>;

  readonly #stateKey = 'transactions';

  readonly #lastScanTokensKey = 'lastScanTokens';

  constructor(state: State<TransactionStateValue>) {
    this.#state = state;
  }

  async getAll(): Promise<KeyringTransaction[]> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    return toKeyringTransactions(
      Object.values(transactionsByAccount ?? {}).flat(),
    );
  }

  async findByAccountIds(
    accountIds: string[],
    scope?: KnownCaip2ChainId,
  ): Promise<KeyringTransaction[]> {
    return toKeyringTransactions(
      await this.findStellarTransactionsByAccountIds(accountIds, scope),
    );
  }

  async findStellarTransactionsByAccountIds(
    accountIds: string[],
    scope?: KnownCaip2ChainId,
  ): Promise<StellarKeyringTransaction[]> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    const transactions: StellarKeyringTransaction[] = [];
    for (const accountId of accountIds) {
      const accountTransactions = transactionsByAccount?.[accountId] ?? [];
      transactions.push(
        ...accountTransactions.filter((transaction) =>
          scope
            ? transaction.chain === (scope as KeyringTransaction['chain'])
            : true,
        ),
      );
    }
    return transactions;
  }

  async findByAccountId(accountId: string): Promise<KeyringTransaction[]> {
    const transactionsByAccount = await this.#state.getKey<
      TransactionStateValue['transactions']
    >(this.#stateKey);

    return toKeyringTransactions(transactionsByAccount?.[accountId] ?? []);
  }

  async findLastScanTokenByAccountIds(
    accountIds: string[],
    scope: KnownCaip2ChainId,
  ): Promise<Record<string, string | null>> {
    const lastScanTokens = await this.#state.getKey<
      TransactionStateValue['lastScanTokens']
    >(this.#lastScanTokensKey);

    const lastScanTokenByAccountId: Record<string, string | null> = {};

    for (const accountId of accountIds) {
      lastScanTokenByAccountId[accountId] =
        lastScanTokens?.[accountId]?.[scope] ?? null;
    }
    return lastScanTokenByAccountId;
  }

  async save(transaction: StellarKeyringTransaction): Promise<void> {
    await this.saveMany([transaction]);
  }

  /**
   * Applies transaction updates to snap state in a single locked write.
   *
   * Submitted transactions are upserted locally. Confirmed and failed transactions
   * remove any matching id from snap state — durable history lives in the controller
   * after AccountTransactionsUpdated is emitted. Pending transactions that exceed both
   * `maxReconcileAttempts` and `maxPendingTransactionAge` are also evicted.
   *
   * @param transactions - Transactions to reconcile into snap state.
   * @param lastScanTokens - Optional scan cursors to persist per account and scope.
   */
  async saveMany(
    transactions: StellarKeyringTransaction[],
    lastScanTokens?: Record<string, Record<KnownCaip2ChainId, string | null>>,
  ): Promise<void> {
    if (transactions.length === 0 && !lastScanTokens) {
      return;
    }

    await this.#state.update((state) => {
      if (!state[this.#stateKey]) {
        state[this.#stateKey] = {};
      }
      if (!state[this.#lastScanTokensKey]) {
        state[this.#lastScanTokensKey] = {};
      }

      const allTransactionsByAccount = state[this.#stateKey];
      const allLastScanTokensByAccountId = state[this.#lastScanTokensKey];

      if (lastScanTokens) {
        for (const [accountId, lastScanToken] of Object.entries(
          lastScanTokens,
        )) {
          state[this.#lastScanTokensKey][accountId] = {
            ...(allLastScanTokensByAccountId[accountId] ?? {}),
            ...lastScanToken,
          };
        }
      }

      if (transactions.length > 0) {
        const transactionsByAccount = groupBy(transactions, 'account');

        for (const [accountId, accountTransactions] of Object.entries(
          transactionsByAccount,
        )) {
          const existingTransactions =
            allTransactionsByAccount[accountId] ?? [];
          state[this.#stateKey][accountId] = this.#applyTransactionUpdate(
            existingTransactions,
            accountTransactions,
          );
        }
      }

      return state;
    });
  }

  #applyTransactionUpdate(
    existingTransactions: StellarKeyringTransaction[],
    incomingTransactions: StellarKeyringTransaction[],
  ): StellarKeyringTransaction[] {
    const merged = [...incomingTransactions, ...existingTransactions];
    // Merge the transactions based on transaction id and choose the incoming one if there are duplicates
    // Sort it by timestamp in descending order
    // Filter out completed transactions and pending txs eligible for eviction
    return sortBy(
      uniqBy(merged, 'id'),
      (item) => -(item.timestamp ?? 0),
    ).filter((transaction) => this.#canSave(transaction));
  }

  /**
   * Checks if the transaction can be saved to snap state.
   *
   * Keeps pending transactions unless both reconcile attempts and max age are exceeded.
   *
   * @param transaction - The transaction to check.
   * @returns Whether the transaction can be saved to snap state.
   */
  #canSave(transaction: StellarKeyringTransaction): boolean {
    return (
      isPendingTransactionStatus(transaction.status) &&
      !shouldDropPendingTransaction(transaction)
    );
  }
}
