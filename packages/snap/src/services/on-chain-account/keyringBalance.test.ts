import { BigNumber } from 'bignumber.js';

import {
  getDefaultBalanceEntry,
  toClassicBalanceEntry,
  toNativeBalanceEntry,
  toStandardBalanceEntry,
} from './keyringBalance';
import { NATIVE_ASSET_SYMBOL, STELLAR_DECIMAL_PLACES } from '../../constants';

describe('toNativeBalanceEntry', () => {
  it('formats amount in display units and keeps spendable/reserve metadata in stroops', () => {
    expect(
      toNativeBalanceEntry({
        nativeBalance: new BigNumber(15_000_000),
        spendableBalance: new BigNumber(5_000_000),
        minimumReserveBalance: new BigNumber(10_000_000),
      }),
    ).toStrictEqual({
      unit: NATIVE_ASSET_SYMBOL,
      amount: '1.5',
      metadata: {
        spendableBalance: '5000000',
        minimumReserveBalance: '10000000',
        decimal: STELLAR_DECIMAL_PLACES,
      },
    });
  });
});

describe('toClassicBalanceEntry', () => {
  it('formats classic trustline amount with limit, authorized, and sponsor metadata', () => {
    expect(
      toClassicBalanceEntry({
        symbol: 'USDC',
        balance: new BigNumber(12_500_000),
        decimals: 7,
        limit: new BigNumber(100_000_000),
        authorized: false,
        sponsor: 'GSPONSOR',
      }),
    ).toStrictEqual({
      unit: 'USDC',
      amount: '1.25',
      metadata: {
        limit: '10',
        authorized: false,
        sponsor: 'GSPONSOR',
      },
    });
  });

  it('defaults limit to zero and fills authorized and sponsor defaults', () => {
    expect(
      toClassicBalanceEntry({
        symbol: 'USDC',
        balance: new BigNumber(0),
        decimals: 7,
      }),
    ).toStrictEqual({
      unit: 'USDC',
      amount: '0',
      metadata: {
        limit: '0',
        authorized: true,
        sponsor: '',
      },
    });
  });

  it('formats limit using asset decimals', () => {
    expect(
      toClassicBalanceEntry({
        symbol: 'TOKEN',
        balance: new BigNumber(1_000),
        decimals: 3,
        limit: new BigNumber(5_000),
        authorized: true,
        sponsor: '',
      }),
    ).toStrictEqual({
      unit: 'TOKEN',
      amount: '1',
      metadata: {
        limit: '5',
        authorized: true,
        sponsor: '',
      },
    });
  });
});

describe('toStandardBalanceEntry', () => {
  it('formats SEP-41 amount without metadata', () => {
    expect(
      toStandardBalanceEntry({
        symbol: 'TOKEN',
        balance: new BigNumber(1_000_000),
        decimals: 6,
      }),
    ).toStrictEqual({
      unit: 'TOKEN',
      amount: '1',
    });
  });
});

describe('getDefaultBalanceEntry', () => {
  it('returns a zero native balance entry with zero metadata', () => {
    expect(getDefaultBalanceEntry()).toStrictEqual({
      unit: NATIVE_ASSET_SYMBOL,
      amount: '0',
      metadata: {
        spendableBalance: '0',
        minimumReserveBalance: '0',
        decimal: STELLAR_DECIMAL_PLACES,
      },
    });
  });
});
