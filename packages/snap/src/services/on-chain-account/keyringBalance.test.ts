import { BigNumber } from 'bignumber.js';

import {
  getDefaultBalanceEntry,
  toClassicBalanceEntry,
  toNativeBalanceEntry,
  toStandardBalanceEntry,
} from './keyringBalance';
import { NATIVE_ASSET_SYMBOL } from '../../constants';

describe('toNativeBalanceEntry', () => {
  it('formats display amount without metadata by default', () => {
    expect(
      toNativeBalanceEntry({
        nativeBalance: new BigNumber(15_000_000),
        spendableBalance: new BigNumber(5_000_000),
        minimumReserveBalance: new BigNumber(10_000_000),
      }),
    ).toStrictEqual({
      unit: NATIVE_ASSET_SYMBOL,
      amount: '1.5',
    });
  });

  it('includes spendable and reserve metadata in stroops when enabled', () => {
    expect(
      toNativeBalanceEntry(
        {
          nativeBalance: new BigNumber(15_000_000),
          spendableBalance: new BigNumber(5_000_000),
          minimumReserveBalance: new BigNumber(10_000_000),
        },
        true,
      ),
    ).toStrictEqual({
      unit: NATIVE_ASSET_SYMBOL,
      amount: '1.5',
      metadata: {
        spendableBalance: '5000000',
        minimumReserveBalance: '10000000',
      },
    });
  });
});

describe('toClassicBalanceEntry', () => {
  it('formats classic trustline amount without metadata by default', () => {
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
    });
  });

  it('includes limit, authorized, and sponsor metadata when enabled', () => {
    expect(
      toClassicBalanceEntry(
        {
          symbol: 'USDC',
          balance: new BigNumber(12_500_000),
          decimals: 7,
          limit: new BigNumber(100_000_000),
          authorized: false,
          sponsor: 'GSPONSOR',
        },
        true,
      ),
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

  it('defaults limit to zero and fills authorized and sponsor defaults when enabled', () => {
    expect(
      toClassicBalanceEntry(
        {
          symbol: 'USDC',
          balance: new BigNumber(0),
          decimals: 7,
        },
        true,
      ),
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
  it('returns a zero native balance entry without metadata by default', () => {
    expect(getDefaultBalanceEntry()).toStrictEqual({
      unit: NATIVE_ASSET_SYMBOL,
      amount: '0',
    });
  });
});
