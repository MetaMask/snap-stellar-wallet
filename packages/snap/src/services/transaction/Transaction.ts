import { TransactionStatus } from '@metamask/keyring-api';
import type {
  Transaction as StellarTransaction,
  Operation,
  Horizon,
} from '@stellar/stellar-sdk';
import {
  FeeBumpTransaction,
  TransactionBuilder as StellarTransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionDeserializationException } from './exceptions';
import { parseExpirationMaxTime } from './utils';
import type { KnownCaip2ChainId } from '../../api';
import { bufferToUint8Array } from '../../utils';
import { caip2ChainIdToNetwork, networkToCaip2ChainId } from '../network/utils';

/**
 * Wrapper around a Stellar transaction. Exposes fees, operation metadata, and network/scope
 * accessors for callers.
 */
export class Transaction {
  readonly #inner: StellarTransaction | FeeBumpTransaction;

  readonly #feeCharged: BigNumber;

  readonly #operationTypes: Set<string> = new Set<string>();

  readonly #participatingAccounts: Set<string> = new Set<string>();

  readonly #invokedByAccounts: Set<string> = new Set<string>();

  readonly #status: TransactionStatus = TransactionStatus.Submitted;

  constructor(
    inner: StellarTransaction | FeeBumpTransaction,
    options?: { feeCharged?: BigNumber; status?: TransactionStatus },
  ) {
    this.#inner = inner;
    // if the fee charged is not provided, use the fee of the transaction as default.
    this.#feeCharged = options?.feeCharged ?? new BigNumber(inner.fee);
    this.#status = options?.status ?? TransactionStatus.Submitted;
    this.#initialize();
  }

  #initialize(): void {
    this.#invokedByAccounts.add(this.sourceAccount);
    this.#invokedByAccounts.add(this.feeSourceAccount);

    this.#participatingAccounts.add(this.sourceAccount);
    this.#participatingAccounts.add(this.feeSourceAccount);

    for (const operation of this.transactionOperations) {
      const source = operation.source ?? this.sourceAccount;
      // Source of the operation should count as invoked by the account
      this.#invokedByAccounts.add(source);
      this.#participatingAccounts.add(source);

      // Destination of the operation should count as participating in the transaction.
      // For now, we only support payment related operations
      if (operation.type === 'pathPaymentStrictSend') {
        this.#participatingAccounts.add(operation.destination);
      } else if (operation.type === 'pathPaymentStrictReceive') {
        this.#participatingAccounts.add(operation.destination);
      } else if (operation.type === 'payment') {
        this.#participatingAccounts.add(operation.destination);
      }

      this.#operationTypes.add(operation.type);
    }
  }

  /**
   * Memo for confirmations: lowercase hex for hash/return (32 raw bytes), decimal string for
   * id, UTF-8 for text (up to 28 on-chain bytes), or null when the memo is `none` or missing.
   *
   * @returns Encoded memo string or null.
   */
  getMemo(): string | null {
    const raw = this.getRaw();
    const memo =
      raw instanceof FeeBumpTransaction ? raw.innerTransaction.memo : raw.memo;

    if (!memo) {
      return null;
    }

    switch (memo.type) {
      case 'hash':
      case 'return': {
        const { value } = memo;
        if (value === undefined || value === null) {
          return null;
        }
        return bufferToUint8Array(value).toString('hex');
      }
      case 'id': {
        const { value } = memo;
        if (value === undefined || value === null) {
          return null;
        }
        return typeof value === 'string' ? value : String(value);
      }
      case 'text': {
        const { value } = memo;
        if (value === undefined || value === null) {
          return null;
        }
        return bufferToUint8Array(value).toString('utf8');
      }
      case 'none':
      default:
        return null;
    }
  }

  /**
   * The expiration time of the transaction.
   *
   * @see https://github.com/stellar/js-stellar-base/blob/master/src/transaction_builder.js#L320
   *
   * @returns Unix timestamp (seconds) for `maxTime`, or `undefined` when there is no upper bound (`maxTime` of `0`).
   */
  get expirationTime(): number | undefined {
    const raw = this.getRaw();
    if (raw instanceof FeeBumpTransaction) {
      return parseExpirationMaxTime(raw.innerTransaction.timeBounds?.maxTime);
    }
    return parseExpirationMaxTime(raw.timeBounds?.maxTime);
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
   * Actual fee charged by the network in stroops.
   * For unsigned/local transactions this equals {@link totalFee}. For on-chain Horizon transactions
   * this can be different and is sourced from `fee_charged`.
   *
   * @returns The actual charged fee as BigNumber.
   */
  get feeCharged(): BigNumber {
    return this.#feeCharged;
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
   * Accounts that participate in the envelope:
   * - tx source,
   * - fee source
   * - each operation’s effective source
   * - destination of the payment related operations
   *
   * @returns Participating account ids (`G…`).
   */
  get participatingAccounts(): string[] {
    return Array.from(this.#participatingAccounts.values());
  }

  /**
   * The transaction ID.
   * Equivalent to TransactionHash.
   *
   * @returns The transaction ID.
   */
  get id(): string {
    return this.#inner.hash().toString('hex');
  }

  /**
   * Keyring transaction status for this envelope.
   * Defaults to {@link TransactionStatus.Submitted} for unsigned/local envelopes;
   * {@link Transaction.fromHorizon} sets {@link TransactionStatus.Confirmed} or
   * {@link TransactionStatus.Failed} from the Horizon record.
   */
  get status(): TransactionStatus {
    return this.#status;
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
   * Whether the account is among {@link Transaction.hasParticipatingAccount}.
   *
   * @param accountId - The account ID to check.
   * @returns True if the account participates in the envelope, false otherwise.
   */
  hasParticipatingAccount(accountId: string): boolean {
    return this.#participatingAccounts.has(accountId);
  }

  /**
   * Checks if the transaction is invoked by the given account.
   *
   * @param accountId - The account ID to check.
   * @returns True if the transaction is invoked by the given account, false otherwise.
   */
  isInvokedByAccount(accountId: string): boolean {
    return this.#invokedByAccounts.has(accountId);
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

  /**
   * Creates a wrapped transaction from a Stellar SDK transaction.
   *
   * @param transaction - Stellar SDK transaction.
   * @returns Wrapped transaction.
   */
  static fromRaw(
    transaction: StellarTransaction | FeeBumpTransaction,
  ): Transaction {
    return new Transaction(transaction);
  }

  /**
   * Creates a wrapped transaction from envelope XDR.
   *
   * @param params - XDR parsing input.
   * @param params.xdr - Envelope XDR.
   * @param params.scope - CAIP-2 network scope.
   * @returns Wrapped transaction.
   */
  static fromXdr(params: {
    xdr: string;
    scope: KnownCaip2ChainId;
  }): Transaction {
    const { xdr, scope } = params;
    try {
      const decoded = StellarTransactionBuilder.fromXDR(
        xdr,
        caip2ChainIdToNetwork(scope),
      );
      return Transaction.fromRaw(decoded);
    } catch {
      throw new TransactionDeserializationException();
    }
  }

  /**
   * Creates a wrapped transaction from Horizon transaction record.
   *
   * @param params - Horizon parsing input.
   * @param params.horizonTransaction - Horizon transaction record.
   * @param params.scope - CAIP-2 network scope.
   * @returns Wrapped transaction with `feeCharged` and `status` from Horizon.
   */
  static fromHorizon(params: {
    horizonTransaction: Horizon.ServerApi.TransactionRecord;
    scope: KnownCaip2ChainId;
  }): Transaction {
    const { horizonTransaction, scope } = params;
    const wrapped = Transaction.fromXdr({
      xdr: horizonTransaction.envelope_xdr,
      scope,
    });

    const status = horizonTransaction.successful
      ? TransactionStatus.Confirmed
      : TransactionStatus.Failed;

    return new Transaction(wrapped.getRaw(), {
      feeCharged: new BigNumber(horizonTransaction.fee_charged),
      status,
    });
  }
}
