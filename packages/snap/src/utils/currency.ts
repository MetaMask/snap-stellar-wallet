import { BigNumber } from 'bignumber.js';

import { STELLAR_DECIMAL_PLACES } from '../constants';

/**
 * Converts an amount to the smallest unit of the asset.
 *
 * @example toSmallestUnit(new BigNumber('12.3456789')) // 123456789 stroops
 *
 * @param amount - The amount to convert.
 * @param decimalPlaces - The number of decimal places to use.
 * @returns The amount in the smallest unit.
 */
export function toSmallestUnit(
  amount: BigNumber,
  decimalPlaces: number = STELLAR_DECIMAL_PLACES,
): BigNumber {
  return amount.multipliedBy(BigNumber(10).pow(decimalPlaces));
}

/**
 * Converts an amount from the smallest unit to a human-readable amount.
 *
 * @example normalizeAmount(new BigNumber(123456789)) // 12.3456789
 *
 * @param amount - Amount in stroops.
 * @param decimalPlaces - The number of decimal places to use.
 * @returns The amount in the human-readable format.
 */
export function normalizeAmount(
  amount: BigNumber,
  decimalPlaces: number = STELLAR_DECIMAL_PLACES,
): BigNumber {
  return amount.dividedBy(BigNumber(10).pow(decimalPlaces));
}
