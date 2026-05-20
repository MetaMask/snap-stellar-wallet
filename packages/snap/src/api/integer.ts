import { nonempty, refine, string, type Infer } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';

import { MAX_INT64, STELLAR_DECIMAL_PLACES } from '../constants';
import { toSmallestUnit } from '../utils/currency';

/**
 * Non-empty string that parses to a finite, non-negative {@link BigNumber} (stroops or human-readable amounts).
 * Uses `refine` so `assert` / `validate` enforce this; not only `create` with coercion.
 */
export const PositiveNumberStringStruct = refine(
  nonempty(string()),
  'positive_number_string',
  (value: string) => {
    try {
      const bn = new BigNumber(value);
      if (bn.isNaN() || !bn.isFinite()) {
        return 'Invalid positive number';
      }
      if (bn.isLessThan(0)) {
        return 'Not a positive number';
      }
      return true;
    } catch {
      return 'Invalid positive number';
    }
  },
);

/**
 * Non-empty string that parses to a finite, non-negative {@link BigNumber}.
 * The amount is converted to the smallest unit of the asset and validated against the maximum int64.
 * Uses `refine` so `assert` / `validate` enforce this; not only `create` with coercion.
 */
export const ValidAmountStruct = refine(
  nonempty(string()),
  'valid_amount',
  (value: string) => {
    try {
      const amount = new BigNumber(value);
      const decimalPlaces = amount.decimalPlaces();
      if (
        // < 0
        amount.isNegative() ||
        // > Max value
        toSmallestUnit(amount).gt(new BigNumber(MAX_INT64).toString()) ||
        // Decimal places (max 7)
        (decimalPlaces && decimalPlaces > STELLAR_DECIMAL_PLACES) ||
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
 * Non-empty string that parses to a finite, non-negative {@link BigNumber} and is not zero.
 * The amount is converted to the smallest unit of the asset and validated against the maximum int64.
 * Uses `refine` so `assert` / `validate` enforce this; not only `create` with coercion.
 */
export const NonZeroValidAmountStruct = refine(
  ValidAmountStruct,
  'non_zero_valid_amount',
  (value: string) => {
    const amount = new BigNumber(value);
    if (amount.isZero()) {
      return 'Amount cannot be zero';
    }
    return true;
  },
);

export type NonZeroValidAmount = Infer<typeof NonZeroValidAmountStruct>;

export type ValidAmount = Infer<typeof ValidAmountStruct>;

export type PositiveNumberString = Infer<typeof PositiveNumberStringStruct>;
