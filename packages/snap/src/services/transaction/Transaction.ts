import type {
  Transaction as StellarTransaction,
  Operation,
  Memo,
} from '@stellar/stellar-sdk';
import { FeeBumpTransaction } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { KnownCaip2ChainId } from '../../api';
import { bufferToUint8Array } from '../../utils';
import { networkToCaip2ChainId } from '../network/utils';

/**
 * Wrapper around a Stellar transaction. Exposes fee, operation count, and network passphrase
 * for callers.
 */
export class Transaction {
  readonly #inner: StellarTransaction | FeeBumpTransaction;

  readonly #operationTypes: Set<string> = new Set<string>();

  readonly #participatingAccounts: Set<string> = new Set<string>();

  constructor(inner: StellarTransaction | FeeBumpTransaction) {
    this.#inner = inner;
    this.#initialize();
  }

  #initialize(): void {
    this.#participatingAccounts.add(this.sourceAccount);
    this.#participatingAccounts.add(this.feeSourceAccount);

    for (const operation of this.transactionOperations) {
      this.#participatingAccounts.add(operation.source ?? this.sourceAccount);
      this.#operationTypes.add(operation.type);
    }
  }

  getMemo(): string | null {
    const raw = this.getRaw();
    let memo: Memo | null = null;

    if (raw instanceof FeeBumpTransaction) {
      memo = raw.innerTransaction.memo;
    } else {
      memo = raw.memo;
    }

    if (memo) {
      switch (memo.type) {
        case 'hash':
        case 'return':
          // Hash and return memo value is always hex, so encoded to hex
          return memo?.value
            ? bufferToUint8Array(memo?.value).toString('hex')
            : null;
        case 'id':
          // ID memo value is always a uint64, so encoded to string
          return memo?.value ? memo?.value.toString() : null;
        case 'text':
          // Text memo value is always a ASCII string, so encoded to utf8
          return memo?.value
            ? bufferToUint8Array(memo?.value).toString('utf8')
            : null;
        case 'none':
        default:
          return null;
      }
    }
    return null;
  }

  /**
   * Total fee in stroops charged to {@link Transaction.feeSourceAccount} for this envelope.
   * If it is a fee bump transaction, it will be the fee of the fee bump transaction, instead of the inner transaction.
   *
   * @returns The fee as BigNumber.
   */
  get totalFee(): BigNumber {
    const raw = this.getRaw();
    return new BigNumber(raw.fee);
  }

  /**
   * The number of operations on the wrapped envelope (inner transaction for fee bumps).
   * Uses the same source as {@link Transaction.transactionOperations} so counts stay aligned.
   *
   * @returns The operation count.
   */
  get operationCount(): number {
    return this.transactionOperations.length;
  }

  /**
   * Network passphrase on the underlying transaction (matches Stellar SDK `networkPassphrase`).
   *
   * @returns The network passphrase string.
   */
  get network(): string {
    return this.#inner.networkPassphrase;
  }

  /**
   * Get the CAIP-2 chain ID from the network passphrase.
   *
   * @returns The CAIP-2 chain ID.
   */
  get scope(): KnownCaip2ChainId {
    return networkToCaip2ChainId(this.#inner.networkPassphrase);
  }

  /**
   * Checks if the transaction has a create account operation.
   *
   * @returns True if the transaction has a create account operation, false otherwise.
   */
  get hasCreateAccount(): boolean {
    return this.#operationTypes.has('createAccount');
  }

  /**
   * Checks if the transaction has an `invokeHostFunction` operation.
   *
   * @returns True if the transaction has an invoke host function operation, false otherwise.
   */
  get hasInvokeHostFunction(): boolean {
    return this.#operationTypes.has('invokeHostFunction');
  }

  /**
   * Get the source account from the transaction.
   *
   * @returns The source account.
   */
  get sourceAccount(): string {
    const raw = this.getRaw();
    if (raw instanceof FeeBumpTransaction) {
      return raw.innerTransaction.source;
    }
    return raw.source;
  }

  /**
   * Get the fee source account from the transaction.
   *
   * @returns The fee source account.
   */
  get feeSourceAccount(): string {
    const raw = this.getRaw();
    let feeSource: string | undefined;
    if (raw instanceof FeeBumpTransaction) {
      feeSource = raw.feeSource;
    } else {
      feeSource = raw.source;
    }

    if (!feeSource) {
      throw new Error('Fee source account is not set');
    }

    return feeSource;
  }

  /**
   * Accounts that participate in the envelope: tx source, fee source, and each operation’s effective source.
   *
   * @returns Participating account ids (`G…`).
   */
  get participatingAccounts(): string[] {
    return Array.from(this.#participatingAccounts.values());
  }

  /**
   * Checks if the transaction is from the given account.
   *
   * @param accountId - The account ID to check.
   * @returns True if the transaction is from the given account, false otherwise.
   */
  isSourceAccount(accountId: string): boolean {
    return (
      this.sourceAccount === accountId || this.feeSourceAccount === accountId
    );
  }

  /**
   * Whether the account is among {@link Transaction.hasParticipatingAccount} (source, fee source, or op source).
   *
   * @param accountId - The account ID to check.
   * @returns True if the account participates in the envelope.
   */
  hasParticipatingAccount(accountId: string): boolean {
    return this.#participatingAccounts.has(accountId);
  }

  /**
   * The raw SDK transaction. Prefer the wrapped API where possible; use this for signing and submission.
   *
   * @returns The raw Stellar SDK transaction.
   */
  getRaw(): StellarTransaction | FeeBumpTransaction {
    return this.#inner;
  }

  /**
   * Get the operations from the transaction.
   *
   * @returns The operations.
   */
  get transactionOperations(): Operation[] {
    const raw = this.getRaw();
    if (raw instanceof FeeBumpTransaction) {
      return raw.innerTransaction.operations;
    }
    return raw.operations;
  }
}
