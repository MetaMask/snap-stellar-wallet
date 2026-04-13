import { BigNumber } from 'bignumber.js';

import { normalizeAmount, toSmallestUnit } from './currency';

describe('toSmallestUnit', () => {
  it('converts human amount to stroops', () => {
    expect(toSmallestUnit(new BigNumber('12.3456789')).toFixed(0)).toBe(
      '123456789',
    );
  });

  it('converts integer XLM to stroops', () => {
    expect(toSmallestUnit(new BigNumber(1)).toFixed(0)).toBe('10000000');
  });
});

describe('normalizeAmount', () => {
  it('converts stroops to human amount', () => {
    expect(normalizeAmount(new BigNumber(123456789)).toString()).toBe(
      '12.3456789',
    );
  });
});

describe('toSmallestUnit and normalizeAmount', () => {
  it('roundtrips for representative values', () => {
    const human = new BigNumber('12.3456789');
    const stroops = toSmallestUnit(human);
    expect(normalizeAmount(stroops).toString()).toBe(human.toString());
  });
});
