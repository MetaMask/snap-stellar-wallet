import { nonempty, refine, string, type Infer } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';

import { MAX_INT64, STELLAR_DECIMAL_PLACES } from '../constants';
import { toSmallestUnit } from '../utils/currency';

/**
 * Non-empty string that parses to a finite, non-negative {@link BigNumber}.
 */
export const ValidAmountStruct = refine(
  nonempty(string()),
  'valid_amount',
  (value: string) => {
    try {
      const amount = new BigNumber(value);
      if (
        // < 0
        amount.isNegative() ||
        // NaN or Infinity
        amount.isNaN() ||
        !amount.isFinite()
      ) {
        return 'Invalid amount';
      }
      return true;
    } catch {
      return 'Invalid amount';
    }
  },
);

/**
 * Non-empty string that parses to a finite, non-negative {@link BigNumber} and is not above the maximum int64.
 * The amount is converted to the smallest unit of the asset and validated against the maximum int64.
 */
export const ValidStellarAmountStruct = refine(
  ValidAmountStruct,
  'valid_stellar_amount',
  (value: string) => {
    try {
      const amount = new BigNumber(value);
      const decimalPlaces = amount.decimalPlaces();
      if (
        (decimalPlaces && decimalPlaces > STELLAR_DECIMAL_PLACES) ||
        // > Max value
        toSmallestUnit(amount).gt(new BigNumber(MAX_INT64).toString())
      ) {
        return 'Invalid amount';
      }
      return true;
    } catch {
      return 'Invalid amount';
    }
  },
);

/**
 * Non-empty string that parses to a finite, non-negative {@link BigNumber} and is not zero.
 * The amount is converted to the smallest unit of the asset and validated against the maximum int64.
 */
export const NonZeroValidSetllarAmountStruct = refine(
  ValidStellarAmountStruct,
  'non_zero_valid_amount',
  (value: string) => {
    const amount = new BigNumber(value);
    if (amount.isZero()) {
      return 'Amount cannot be zero';
    }
    return true;
  },
);

export type NonZeroValidAmount = Infer<typeof NonZeroValidSetllarAmountStruct>;

export type ValidAmount = Infer<typeof ValidAmountStruct>;

export type ValidStellarAmount = Infer<typeof ValidStellarAmountStruct>;
