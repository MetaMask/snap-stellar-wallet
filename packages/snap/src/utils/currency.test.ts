import type { CaipAssetType } from '@metamask/utils';
import * as metamaskUtils from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import {
  formatFiat,
  getFiatTicker,
  isFiat,
  normalizeAmount,
  tokenToFiat,
  toSmallestUnit,
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

describe('toSmallestUnit and normalizeAmount', () => {
  it('roundtrips for representative values', () => {
    const human = new BigNumber('12.3456789');
    const stroops = toSmallestUnit(human);
    expect(normalizeAmount(stroops).toString()).toBe(human.toString());
  });
});

describe('formatFiat', () => {
  it('uses locale segment before underscore and currency style options', () => {
    const toLocaleStringSpy = jest
      .spyOn(Number.prototype, 'toLocaleString')
      .mockReturnValue('formatted');

    expect(formatFiat('12.345', 'USD', 'en_US')).toBe('formatted');

    expect(toLocaleStringSpy).toHaveBeenCalledWith('en', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });

    toLocaleStringSpy.mockRestore();
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
  it('returns true for CAIP asset ids containing swift ISO4217 segment', () => {
    expect(isFiat('eip155:1/swift:0/iso4217:USD' as CaipAssetType)).toBe(true);
  });

  it('returns false for stellar asset ids', () => {
    expect(
      isFiat(
        'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as CaipAssetType,
      ),
    ).toBe(false);
  });
});

describe('getFiatTicker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when asset id is not fiat', () => {
    expect(() =>
      getFiatTicker('stellar:pubnet/slip44:148' as CaipAssetType),
    ).toThrow('Passed assetId is not a fiat asset');
  });

  it('returns lowercase asset reference from parser', () => {
    jest.spyOn(metamaskUtils, 'parseCaipAssetType').mockReturnValue({
      assetReference: 'EUR',
    } as ReturnType<typeof metamaskUtils.parseCaipAssetType>);

    expect(getFiatTicker('ignored/swift:0/iso4217:EUR' as CaipAssetType)).toBe(
      'eur',
    );
  });
});
