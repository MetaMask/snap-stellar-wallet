import { BigNumber } from 'bignumber.js';

import { multiplyFee } from './utils';
import { AppConfig } from '../../config';
import { toSmallestUnit } from '../../utils';

const maxFeeThresholdInStroops = toSmallestUnit(
  new BigNumber(AppConfig.transaction.maxFeeThresholdInXLM),
);

describe('multiplyFee', () => {
  it('multiplies fee by multiplier and rounds up to nearest integer', () => {
    expect(multiplyFee(new BigNumber(11), 1.2)).toStrictEqual(
      new BigNumber(14),
    );
  });

  it('caps fee at maxFeeThresholdInXLM when multiplied fee exceeds threshold', () => {
    expect(multiplyFee(new BigNumber(2_000_000), 10)).toStrictEqual(
      maxFeeThresholdInStroops,
    );
  });

  it('returns multiplied fee when below threshold', () => {
    expect(multiplyFee(new BigNumber(100), 1)).toStrictEqual(
      new BigNumber(100),
    );
  });
});
