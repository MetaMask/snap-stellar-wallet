import type { OperationRecord } from '@stellar/stellar-sdk';

import { TransactionValidationException } from '../exceptions';
import type { AccountState, SimulationState } from './api';
import { calculateSpendableBalance } from '../../on-chain-account/utils';

/**
 * Gets the effective source account ID from the operation.
 * Returns the source account ID from the operation if it is set, otherwise returns the transaction source.
 *
 * @param op - The operation.
 * @param txSource - The transaction source.
 * @returns Effective source account public key.
 */
export function effectiveSource(op: OperationRecord, txSource: string): string {
  return op.source ?? txSource;
}

/**
 * Calculates the spendable native balance for an account.
 *
 * @param account - The account state.
 * @returns Spendable native balance in stroops.
 */
export function getSpendableNative(account: AccountState): BigNumber {
  return calculateSpendableBalance({
    nativeBalance: account.nativeRawBalance,
    subentryCount: account.subentryCount,
    numSponsoring: account.numSponsoring,
    numSponsored: account.numSponsored,
  });
}

/**
 * Gets the account state from the simulation state.
 *
 * @param state - The simulation state.
 * @param accountId - The account ID.
 * @returns Mutable account state for the given id.
 */
export function getAccount(
  state: SimulationState,
  accountId: string,
): AccountState {
  const account = state.accounts.get(accountId);
  if (account === undefined) {
    throw new TransactionValidationException(
      `Account not loaded: ${accountId}`,
    );
  }
  return account;
}
