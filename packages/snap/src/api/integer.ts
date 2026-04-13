import { nonempty, refine, string, type Infer } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';

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

export type PositiveNumberString = Infer<typeof PositiveNumberStringStruct>;
