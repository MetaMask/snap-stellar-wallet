import type { Operation } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
  UnsupportedOperationTypeException,
} from './exceptions';
import type {
  AccountState,
  SimulationState,
  TrustlineState,
  OperationSimulator,
} from './simulation';
import {
  ChangeTrustOPSimulator,
  CreateAccountOPSimulator,
  InvokeHostFunctionOPSimulator,
  PathPaymentOPSimulator,
  PaymentOPSimulator,
  getSpendableNative,
  getAccount,
} from './simulation';
import type { Transaction } from './Transaction';
import {
  assertInvokeHostFunctionSoleOperation,
  assertTransactionTimeBound,
  assertTransactionScope,
  assertTransactionSourceAccount,
} from './utils';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import { isClassicAssetId, isSep41Id } from '../../utils';
import type { OnChainAccount } from '../on-chain-account/OnChainAccount';

/**
 * Supported operation types in MetaMask.
 */
type SupportedOPType =
  | Operation.Payment
  | Operation.PathPaymentStrictReceive
  | Operation.PathPaymentStrictSend
  | Operation.CreateAccount
  | Operation.ChangeTrust
  | Operation.InvokeHostFunction;

/**
 * Stellar operation kinds used when validating or simulating transactions.
 */
export enum SupportedOperations {
  Payment = 'payment',
  PathPayment = 'pathPayment',
  CreateAccount = 'createAccount',
  ChangeTrust = 'changeTrust',
  InvokeHostFunction = 'invokeHostFunction',
}

/**
 * Optional settings for {@link TransactionSimulator.simulate}.
 */
export type TransactionSimulatorOptions = {
  expectedOPTypes?: SupportedOperations[];
  /**
   * Extra accounts merged into simulation (e.g. payment destinations). Ignored when simulation path does not apply.
   */
  preloadedAccounts?: OnChainAccount[];
};

export class TransactionSimulator {
  readonly #operationSimulator: Record<SupportedOperations, OperationSimulator>;

  constructor() {
    this.#operationSimulator = {
      payment: new PaymentOPSimulator(),
      pathPayment: new PathPaymentOPSimulator(),
      createAccount: new CreateAccountOPSimulator(),
      changeTrust: new ChangeTrustOPSimulator(),
      invokeHostFunction: new InvokeHostFunctionOPSimulator(),
    };
  }

  /**
   * Inspects envelope operations, optionally enforces expected operation types and Soroban rules,
   * then runs ordered simulation for supported ops; classic ops update balances / trustlines.
   * Soroban `invokeHostFunction` is only allowed as a single-op tx and is a no-op for state.
   * All involved accounts must be known from the wallet snapshot (or {@link TransactionSimulatorOptions.preloadedAccounts}).
   * Payment and path-payment destinations must appear in that set (or preloads) so balances and SEP-29
   * `requiresMemo` can be read; otherwise simulation fails with “account not loaded” before memo checks run.
   * For a sole SEP-41 `transfer` invoke, the sender's contract token balance must appear on that account's {@link OnChainAccount} snapshot (e.g. {@link OnChainAccount.setAsset}).
   *
   * @param transaction - Wrapped Stellar transaction.
   * @param account - Loaded signing account (Horizon-shaped raw for balances).
   * @param options - Optional `expectedOPTypes` and `preloadedAccounts`.
   * @returns Stack of simulation states: fee snapshot first, then one entry per operation after apply.
   * @throws {TransactionScopeNotMatchException} If the transaction scope does not match the account scope.
   * @throws {TransactionValidationException} When the transaction cannot be simulated (wallet not source/fee source, unsupported op, unknown accounts for payments, etc.).
   */
  simulate(
    transaction: Transaction,
    account: OnChainAccount,
    options?: TransactionSimulatorOptions,
  ): SimulationState[] {
    const ops = transaction.transactionOperations;

    // Allow to quit early if any operation not valid (not supported or not expected)
    this.#preflightValidation(ops, account, transaction, options);

    return this.#run({
      operations: ops,
      transaction,
      initialState: this.#buildInitialState(account, options),
    });
  }

  #run(params: {
    operations: SupportedOPType[];
    transaction: Transaction;
    initialState: SimulationState;
  }): SimulationState[] {
    const { operations, initialState, transaction } = params;

    const txSource = transaction.sourceAccount;
    const feeSource = transaction.feeSourceAccount;
    const fee = transaction.totalFee;
    const { scope } = transaction;

    // Validate that the current balance can cover the fee, even if later
    // operations would free the base reserve.
    //
    // For example:
    // - A account has 1.5 XLM total, two trust lines, one of them sponsored (`num_sponsored` = 1).
    // - The Spendable balance = 1.5 XLM - 1 XLM (account base reserve) - 0.5 XLM (trust line base reserve) = 0 XLM
    // - A transaction with 0.0000001 XLM fee will fail the fee validation.
    const feeState = this.#validateAndApplyFeeState({
      state: this.#cloneSimulationState(initialState),
      feeSource,
      fee,
    });

    return operations.reduce<SimulationState[]>(
      (stack, op, opIndex) => {
        const beforeState = stack[stack.length - 1];
        if (beforeState === undefined) {
          throw new TransactionValidationException(
            'Simulation failed: missing state snapshot',
          );
        }

        // Each stack entry is an independent snapshot: we clone before apply.
        const state = this.#cloneSimulationState(beforeState);
        this.#validateOP({
          op,
          opIndex,
          state,
          txSource,
          scope,
          operations,
          transaction,
        });
        this.#applyOP({ op, state, txSource, scope, opIndex });
        stack.push(state);
        return stack;
      },
      [feeState],
    );
  }

  #preflightValidation(
    ops: Operation[],
    account: OnChainAccount,
    transaction: Transaction,
    options?: TransactionSimulatorOptions,
  ): asserts ops is SupportedOPType[] {
    const { expectedOPTypes = [] } = options ?? {};

    // Ensure the transaction is not expired
    assertTransactionTimeBound(transaction);

    // Ensure the transaction scope matches the account scope.
    assertTransactionScope(transaction, account.scope);
    // Envelope must involve this wallet as source or fee source (API XDR or in-app builds).
    // TODO: we may need to relax it in future when we support fee payment by other account.
    assertTransactionSourceAccount(transaction, account.accountId);

    // Soroban `invokeHostFunction` is only allowed as a single-op tx and is a no-op for state.
    assertInvokeHostFunctionSoleOperation(transaction);

    const expectedOPTypeSet = new Set<string>(expectedOPTypes);
    const supportedOPTypeSet = new Set<string>(
      Object.values(SupportedOperations),
    );

    this.#assertOPLength(ops);
    for (const op of ops) {
      this.#assertSupportedOP(op, supportedOPTypeSet);
      this.#assertExpectedOP(op, expectedOPTypeSet);
    }
  }

  #buildInitialState(
    sourceAccount: OnChainAccount,
    options?: TransactionSimulatorOptions,
  ): SimulationState {
    const { preloadedAccounts } = options ?? {};
    const sourceAccountState = this.#buildAccountState(sourceAccount);
    const accounts = new Map([[sourceAccount.accountId, sourceAccountState]]);

    if (preloadedAccounts !== undefined && preloadedAccounts.length > 0) {
      for (const account of preloadedAccounts) {
        if (!accounts.has(account.accountId)) {
          accounts.set(account.accountId, this.#buildAccountState(account));
        }
      }
    }

    return {
      accounts,
    };
  }

  #buildAccountState(account: OnChainAccount): AccountState {
    const trustlines = new Map<KnownCaip19ClassicAssetId, TrustlineState>();
    const sep41Balances = new Map<KnownCaip19Sep41AssetId, BigNumber>();

    for (const assetId of account.assetIds) {
      const row = account.getAsset(assetId);
      if (row === undefined) {
        continue;
      }
      if (isSep41Id(assetId)) {
        sep41Balances.set(assetId, row.balance);
      } else if (isClassicAssetId(assetId)) {
        const { limit } = row;
        if (limit === undefined || limit.isLessThanOrEqualTo(0)) {
          continue;
        }
        trustlines.set(assetId, {
          balance: row.balance,
          limit,
          authorized: row.authorized !== false,
          sponsored: row.sponsored === true,
        });
      }
    }

    return {
      nativeRawBalance: account.nativeRawBalance,
      subentryCount: account.subentryCount,
      numSponsoring: account.numSponsoring,
      numSponsored: account.numSponsored,
      requiresMemo: account.requiresMemo,
      trustlines,
      sep41Balances,
    };
  }

  #assertSupportedOP(
    op: Operation,
    supportedOPTypeSet: Set<string>,
  ): asserts op is SupportedOPType {
    const operationType = this.#supportedOperationType(op);
    if (operationType === null || !supportedOPTypeSet.has(operationType)) {
      throw new UnsupportedOperationTypeException(op.type);
    }
  }

  #assertExpectedOP(op: Operation, types: Set<string>): void {
    const operationType = this.#supportedOperationType(op);
    if (operationType === null) {
      throw new UnsupportedOperationTypeException(op.type);
    }
    if (types.size > 0 && !types.has(operationType)) {
      throw new TransactionValidationException(
        `Unexpected operation type ${op.type}, expected one of: ${Array.from(types).join(', ')}`,
      );
    }
  }

  #assertOPLength(
    ops: Operation[],
  ): asserts ops is [Operation, ...Operation[]] {
    if (ops.length === 0) {
      throw new TransactionValidationException(
        `Transaction must have at least one operation`,
      );
    }
  }

  #validateAndApplyFeeState(params: {
    state: SimulationState;
    feeSource: string;
    fee: BigNumber;
  }): SimulationState {
    // Assume the state is cloned beforehand
    const { state, feeSource, fee } = params;
    // it is possible that the transaction fee source is different than the wallet user,
    // if the transaction is passed from external, we dont support it yet,
    // hence `getAccount` will throw an error.
    const feePayer = getAccount(state, feeSource);

    const spendable = getSpendableNative(feePayer);
    if (spendable.isLessThan(fee)) {
      throw new InsufficientBalanceToCoverFeeException(
        spendable.toString(),
        fee.toString(),
      );
    }

    // assign new native raw balance to the fee payer in the cloned state
    feePayer.nativeRawBalance = feePayer.nativeRawBalance.minus(fee);
    return state;
  }

  #validateOP(params: {
    op: SupportedOPType;
    opIndex: number;
    state: SimulationState;
    txSource: string;
    scope: KnownCaip2ChainId;
    operations: readonly Operation[];
    transaction: Transaction;
  }): void {
    const { op, opIndex, state, txSource, scope, operations, transaction } =
      params;
    const operationType = this.#getSupportedOperationType(op);

    this.#operationSimulator[operationType].validate(
      {
        state,
        txSource,
        scope,
        opIndex,
        transaction,
      },
      op,
      operations,
    );
  }

  #applyOP(params: {
    op: SupportedOPType;
    state: SimulationState;
    txSource: string;
    scope: KnownCaip2ChainId;
    opIndex: number;
  }): SimulationState {
    const { op, state, txSource, scope, opIndex } = params;
    const operationType = this.#getSupportedOperationType(op);
    // the state will pass by reference, so the changes will be reflected in the original state
    this.#operationSimulator[operationType].apply(
      { state, txSource, scope, opIndex },
      op,
    );
    // return the state after the operation is applied
    return state;
  }

  #cloneSimulationState(state: SimulationState): SimulationState {
    const accounts = new Map<string, AccountState>();
    for (const [accountId, accountState] of state.accounts) {
      accounts.set(accountId, this.#cloneAccountState(accountState));
    }
    return {
      accounts,
    };
  }

  #cloneAccountState(accountState: AccountState): AccountState {
    const trustlines = new Map<KnownCaip19ClassicAssetId, TrustlineState>();
    const sep41Balances = new Map<KnownCaip19Sep41AssetId, BigNumber>();
    const {
      nativeRawBalance,
      subentryCount,
      numSponsoring,
      numSponsored,
      requiresMemo,
    } = accountState;
    for (const [assetId, trustline] of accountState.trustlines) {
      trustlines.set(assetId, {
        balance: new BigNumber(trustline.balance.toString()),
        limit: new BigNumber(trustline.limit.toString()),
        authorized: trustline.authorized,
        sponsored: trustline.sponsored,
      });
    }
    for (const [assetId, balance] of accountState.sep41Balances) {
      sep41Balances.set(assetId, new BigNumber(balance.toString()));
    }
    return {
      nativeRawBalance: new BigNumber(nativeRawBalance.toString()),
      subentryCount,
      numSponsoring,
      numSponsored,
      requiresMemo,
      trustlines,
      sep41Balances,
    };
  }

  #getSupportedOperationType(op: SupportedOPType): SupportedOperations {
    const operationType = this.#supportedOperationType(op);
    if (operationType === null) {
      throw new UnsupportedOperationTypeException(op.type);
    }
    return operationType;
  }

  #supportedOperationType(op: Operation): SupportedOperations | null {
    if (op.type === SupportedOperations.Payment) {
      return SupportedOperations.Payment;
    }
    if (
      op.type === 'pathPaymentStrictReceive' ||
      op.type === 'pathPaymentStrictSend'
    ) {
      return SupportedOperations.PathPayment;
    }
    if (op.type === SupportedOperations.CreateAccount) {
      return SupportedOperations.CreateAccount;
    }
    if (op.type === SupportedOperations.ChangeTrust) {
      return SupportedOperations.ChangeTrust;
    }
    if (op.type === SupportedOperations.InvokeHostFunction) {
      return SupportedOperations.InvokeHostFunction;
    }
    return null;
  }
}
