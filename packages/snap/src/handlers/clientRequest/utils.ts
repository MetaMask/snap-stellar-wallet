import {
  type Transaction,
  TransactionValidationException,
} from '../../services/transaction';

/**
 * Guards the user-approved fee during submit-time transaction refresh.
 *
 * Fee is visible in the confirmation dialog, so we fail closed instead of
 * silently signing a refreshed transaction with a higher fee than the user saw.
 *
 * @param params - Confirmed and refreshed transaction pair.
 * @param params.confirmedTransaction - Transaction shown in the confirmation dialog.
 * @param params.refreshedTransaction - Transaction rebuilt after confirmation from fresh on-chain state.
 * @throws {TransactionValidationException} When the refreshed fee is higher than the confirmed fee.
 */
export function assertRefreshedTransactionFeeNotHigher(params: {
  confirmedTransaction: Transaction;
  refreshedTransaction: Transaction;
}): void {
  // We only check the fee here, not the operations. That's fine for send and
  // change-trust: the rebuild keeps the same asset, amount and destination from
  // the request, so the only thing that can change is payment vs createAccount
  // (when the destination gets funded/unfunded), and both move the same funds.
  const { confirmedTransaction, refreshedTransaction } = params;
  if (refreshedTransaction.totalFee.gt(confirmedTransaction.totalFee)) {
    throw new TransactionValidationException(
      'Refreshed transaction fee exceeds confirmed fee',
    );
  }
}
