import { BigNumber } from 'bignumber.js';

import { BASE_RESERVE_STROOPS } from '../../constants';

type CalculateSpendableBalanceParams = {
  nativeBalance: BigNumber;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
};

/**
 * Spendable native balance (stroops): total native minus minimum balance.
 *
 * Minimum balance follows Stellar protocol:
 * `(2 + subentry_count + num_sponsoring − num_sponsored) × base_reserve`.
 *
 * @param params - Total native balance and ledger reserve fields.
 * @param params.nativeBalance - Total native balance in stroops.
 * @param params.subentryCount - Account subentry count (Horizon `subentry_count`).
 * @param params.numSponsoring - Reserves this account sponsors for other entries.
 * @param params.numSponsored - Reserves other accounts sponsor for this account.
 * @returns Spendable native balance in stroops (clamped at zero).
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#minimum-balance
 */
export function calculateSpendableBalance(
  params: CalculateSpendableBalanceParams,
): BigNumber {
  const { nativeBalance, subentryCount, numSponsoring, numSponsored } = params;
  const minBalanceStroops = new BigNumber(2)
    .plus(subentryCount)
    .plus(numSponsoring)
    .minus(numSponsored)
    .times(BASE_RESERVE_STROOPS);

  return BigNumber.maximum(nativeBalance.minus(minBalanceStroops), 0);
}
