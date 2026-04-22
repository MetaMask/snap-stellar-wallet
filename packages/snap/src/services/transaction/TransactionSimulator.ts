import type { Operation } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  InsufficientBalanceToCoverFeeException,
  InvalidInvokeContractStructureException,
  TransactionValidationException,
  UnsupportedOperationTypeException,
} from './exceptions';
import type {
  AccountState,
  SimulationState,
  TrustlineState,
  OperationSimulator,
  Sep41TokenBalanceMapKey,
} from './simulation';
import {
  ChangeTrustOPSimulator,
  CreateAccountOPSimulator,
  InvokeHostFunctionOPSimulator,
  PaymentOPSimulator,
  getSpendableNative,
  getAccount,
  toSep41TokenBalanceMapKey,
} from './simulation';
import type { Transaction } from './Transaction';
import {
  assertTransactionScope,
  assertTransactionSourceAccount,
} from './utils';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import { entries } from '../../utils/array';
import type { OnChainAccount } from '../on-chain-account/OnChainAccount';

/**
 * Supported operation types in MetaMask.
 */
type SupportedOPType =
  | Operation.Payment
  | Operation.CreateAccount
  | Operation.ChangeTrust
  | Operation.InvokeHostFunction;

/**
 * Stellar operation kinds used when validating or simulating transactions.
 */
export enum SupportedOperations {
  Payment = 'payment',
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
  /**
   * Per-account token balances (account id → SEP-41 asset id → smallest units). Flattened internally with {@link toSep41TokenBalanceMapKey}.
   * Used only when the sole invoke is a SEP-41 `transfer`; spend is read from the invoke, not from this map.
   */
  preloadedTokenBalance?: Record<
    string,
    Record<KnownCaip19Sep41AssetId, BigNumber>
  >;
};

export class TransactionSimulator {
  readonly #operationSimulator: Record<SupportedOperations, OperationSimulator>;

  constructor() {
    this.#operationSimulator = {
      payment: new PaymentOPSimulator(),
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
   *
   * @param transaction - Wrapped Stellar transaction.
   * @param account - Loaded signing account (Horizon-shaped raw for balances).
   * @param options - Optional `expectedOPTypes`, `preloadedAccounts`, and `preloadedTokenBalance` (invoke-only SEP-41 `transfer` balance check after fee debit).
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

    // it is required to validate if the current balance is enough to cover the fee,
    // even though later operations may "free" the base reserve.
    // e.g
    // a user has 1.5 xlm, 2 trustlines, 1 of those trustline is sponsored,
    // when he executes a transaction to remove all trustlines and send 0.4 XLM to another
    // account, it will still fail the fee validation.
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

    // Ensure the transaction scope matches the account scope.
    assertTransactionScope(transaction, account.scope);
    // Envelope must involve this wallet as source or fee source (API XDR or in-app builds).
    // TODO: we may need to relax it in future when we support fee payment by other account.
    assertTransactionSourceAccount(transaction, account.accountId);

    const expectedOPTypeSet = new Set<string>(expectedOPTypes);
    const supportedOPTypeSet = new Set<string>(
      Object.values(SupportedOperations),
    );

    this.#assertOPLength(ops);
    this.#assertInvokeHostFunctionSoleOP(transaction);

    for (const op of ops) {
      this.#assertSupportedOP(op, supportedOPTypeSet);
      this.#assertExpectedOP(op, expectedOPTypeSet);
    }
  }

  #buildInitialState(
    sourceAccount: OnChainAccount,
    options?: TransactionSimulatorOptions,
  ): SimulationState {
    const { preloadedAccounts, preloadedTokenBalance } = options ?? {};
    const sourceAccountState = this.#buildAccountState(sourceAccount);
    const accounts = new Map([[sourceAccount.accountId, sourceAccountState]]);

    if (preloadedAccounts !== undefined && preloadedAccounts.length > 0) {
      for (const account of preloadedAccounts) {
        if (!accounts.has(account.accountId)) {
          accounts.set(account.accountId, this.#buildAccountState(account));
        }
      }
    }

    let simulationPreloadedTokenBalance: SimulationState['preloadedTokenBalance'];
    if (preloadedTokenBalance !== undefined) {
      const preloadedTokenBalanceMap = new Map<
        Sep41TokenBalanceMapKey,
        BigNumber
      >();

      entries(preloadedTokenBalance).forEach(([accountId, balancesByAsset]) => {
        entries(balancesByAsset).forEach(([assetId, balance]) => {
          preloadedTokenBalanceMap.set(
            toSep41TokenBalanceMapKey(accountId, assetId),
            balance,
          );
        });
      });

      simulationPreloadedTokenBalance =
        preloadedTokenBalanceMap.size > 0
          ? preloadedTokenBalanceMap
          : undefined;
    }

    return {
      accounts,
      preloadedTokenBalance: simulationPreloadedTokenBalance,
    };
  }

  #buildAccountState(account: OnChainAccount): AccountState {
    const trustlines = new Map<KnownCaip19ClassicAssetId, TrustlineState>();

    for (const assetId of account.classicTrustlineAssetIds) {
      const row = account.getAsset(assetId);
      if (row === undefined) {
        continue;
      }
      const { limit } = row;
      if (limit === undefined) {
        continue;
      }
      trustlines.set(assetId, {
        balance: row.balance,
        limit,
        authorized: row.authorized !== false,
        sponsored: row.sponsored === true,
      });
    }

    return {
      nativeRawBalance: account.nativeRawBalance,
      subentryCount: account.subentryCount,
      numSponsoring: account.numSponsoring,
      numSponsored: account.numSponsored,
      trustlines,
    };
  }

  #assertInvokeHostFunctionSoleOP(transaction: Transaction): void {
    if (transaction.hasInvokeHostFunction && transaction.operationCount !== 1) {
      throw new InvalidInvokeContractStructureException();
    }
  }

  #assertSupportedOP(
    op: Operation,
    supportedOPTypeSet: Set<string>,
  ): asserts op is SupportedOPType {
    if (!supportedOPTypeSet.has(op.type)) {
      throw new UnsupportedOperationTypeException(op.type);
    }
  }

  #assertExpectedOP(op: Operation, types: Set<string>): void {
    if (types.size > 0 && !types.has(op.type)) {
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
  }): void {
    const { op, opIndex, state, txSource, scope, operations } = params;

    this.#operationSimulator[op.type].validate(
      {
        state,
        txSource,
        scope,
        opIndex,
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
    // the state will pass by reference, so the changes will be reflected in the original state
    this.#operationSimulator[op.type].apply(
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
    const tokenBalances = state.preloadedTokenBalance;
    let preloadedTokenBalance: SimulationState['preloadedTokenBalance'];
    if (tokenBalances !== undefined && tokenBalances.size > 0) {
      const cloned = new Map<Sep41TokenBalanceMapKey, BigNumber>();
      for (const [key, balance] of tokenBalances) {
        cloned.set(key, new BigNumber(balance.toString()));
      }
      preloadedTokenBalance = cloned;
    }
    return {
      accounts,
      preloadedTokenBalance,
    };
  }

  #cloneAccountState(accountState: AccountState): AccountState {
    const trustlines = new Map<KnownCaip19ClassicAssetId, TrustlineState>();
    const { nativeRawBalance, subentryCount, numSponsoring, numSponsored } =
      accountState;
    for (const [assetId, trustline] of accountState.trustlines) {
      trustlines.set(assetId, {
        balance: new BigNumber(trustline.balance.toString()),
        limit: new BigNumber(trustline.limit.toString()),
        authorized: trustline.authorized,
        sponsored: trustline.sponsored,
      });
    }
    return {
      nativeRawBalance: new BigNumber(nativeRawBalance.toString()),
      subentryCount,
      numSponsoring,
      numSponsored,
      trustlines,
    };
  }
}
