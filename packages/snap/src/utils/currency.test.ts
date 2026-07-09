import { BigNumber } from 'bignumber.js';

import {
  toDisplayBalance,
  formatFiat,
  getFiatTicker,
  isFiat,
  normalizeAmount,
  tokenToFiat,
  toSmallestUnit,
  removeTrailingZeros,
} from './currency';

describe('toSmallestUnit', () => {
  it('converts human amount to stroops', () => {
    expect(toSmallestUnit(new BigNumber('12.3456789')).toFixed(0)).toBe(
      '123456789',
    );
  });

  it('converts integer XLM to stroops', () => {
    expect(toSmallestUnit(new BigNumber(1)).toFixed(0)).toBe('10000000');
  });

  it('uses custom decimal places when provided', () => {
    expect(toSmallestUnit(new BigNumber('1.23'), 2).toFixed(0)).toBe('123');
  });
});

describe('normalizeAmount', () => {
  it('converts stroops to human amount', () => {
    expect(normalizeAmount(new BigNumber(123456789)).toString()).toBe(
      '12.3456789',
    );
  });

  it('uses custom decimal places when provided', () => {
    expect(normalizeAmount(new BigNumber(123), 2).toString()).toBe('1.23');
  });
});

describe('toDisplayBalance', () => {
  it('avoids scientific notation for one stroop', () => {
    expect(toDisplayBalance(new BigNumber(1), 7)).toBe('0.0000001');
    expect(normalizeAmount(new BigNumber(1), 7).toString()).toBe('1e-7');
  });

  it('trims trailing zeros while keeping significant fractional digits', () => {
    expect(toDisplayBalance(new BigNumber(10), 7)).toBe('0.000001');
  });
});

describe('removeTrailingZeros', () => {
  it('removes trailing zeros from a decimal number', () => {
    expect(removeTrailingZeros('12.345000')).toBe('12.345');
  });

  it('does not strip zeros from integer strings', () => {
    expect(removeTrailingZeros('10')).toBe('10');
    expect(removeTrailingZeros('0')).toBe('0');
  });
});

describe('toSmallestUnit and normalizeAmount', () => {
  it('roundtrips for representative values', () => {
    const human = new BigNumber('12.3456789');
    const stroops = toSmallestUnit(human);
    expect(normalizeAmount(stroops).toString()).toBe(human.toString());
  });
});

describe('formatFiat', () => {
  it('rounds to two decimals before locale formatting and passes currency options', () => {
    const toLocaleStringSpy = jest
      .spyOn(Number.prototype, 'toLocaleString')
      .mockImplementation(function formatFiatLocaleSpy(
        this: number,
        locales?: Intl.LocalesArgument,
        options?: Intl.NumberFormatOptions,
      ) {
        const locale = locales;
        expect(this.valueOf()).toBe(12.35);
        expect(locale).toBe('en');
        expect(options).toStrictEqual({
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        });
        return 'formatted';
      });

    expect(formatFiat('12.345', 'USD', 'en_US')).toBe('formatted');

    expect(toLocaleStringSpy).toHaveBeenCalledTimes(1);

    toLocaleStringSpy.mockRestore();
  });

  it('throws when amount is not finite', () => {
    expect(() => formatFiat('NaN', 'USD', 'en-US')).toThrow(RangeError);
  });
});

describe('tokenToFiat', () => {
  it('multiplies token amount by rate as decimal strings', () => {
    expect(tokenToFiat('10', '2.5')).toBe('25');
  });

  it('handles fractional token amounts', () => {
    expect(tokenToFiat('0.5', '4')).toBe('2');
  });
});

describe('isFiat', () => {
  it('returns true for swift ISO4217 ids', () => {
    expect(isFiat('swift:0/iso4217:USD')).toBe(true);
  });

  it('returns false for chain-prefixed fiat ids', () => {
    expect(isFiat('eip155:1/swift:0/iso4217:USD')).toBe(false);
  });

  it('returns false for stellar asset ids', () => {
    expect(
      isFiat(
        'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
    ).toBe(false);
  });

  it('returns false when ISO4217 segment is not exactly three letters', () => {
    expect(isFiat('swift:0/iso4217:US')).toBe(false);
    expect(isFiat('swift:0/iso4217:USDC')).toBe(false);
  });
});

describe('getFiatTicker', () => {
  it('throws when asset id is not fiat', () => {
    expect(() => getFiatTicker('stellar:pubnet/slip44:148')).toThrow(
      'Passed assetId is not a fiat asset',
    );
  });

  it('returns lowercase asset reference from parser', () => {
    expect(getFiatTicker('swift:0/iso4217:EUR')).toBe('eur');
  });
});
