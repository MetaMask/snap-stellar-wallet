import { assert, StructError } from '@metamask/superstruct';

import {
  NonZeroValidSetllarAmountStruct,
  ValidStellarAmountStruct,
  ValidAmountStruct,
} from './integer';

describe('ValidAmountStruct', () => {
  it.each([
    // MAX_INT64 stroops converted to XLM-style amount.
    '922337203685.4775807',
    '123.1212331321231',
    '0.1',
    '0',
    '0.000000023',
  ])('accepts a valid amount', (value: string) => {
    expect(() => assert(value, ValidAmountStruct)).not.toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => assert('-0.1', ValidAmountStruct)).toThrow(StructError);
  });

  it('rejects non-finite numeric values', () => {
    expect(() => assert('Infinity', ValidAmountStruct)).toThrow(StructError);
    expect(() => assert('NaN', ValidAmountStruct)).toThrow(StructError);
  });
});

describe('ValidStellarAmountStruct', () => {
  it('accepts a valid amount with up to 7 decimal places', () => {
    expect(() => assert('12.3456789', ValidStellarAmountStruct)).not.toThrow();
  });

  it('accepts an amount just below max int64', () => {
    expect(() =>
      assert('922337203685.4775807', ValidStellarAmountStruct),
    ).not.toThrow();
  });

  it('rejects an amount above max int64 when converted to stroops', () => {
    expect(() =>
      assert('922337203685.4775808', ValidStellarAmountStruct),
    ).toThrow(StructError);
  });

  it('rejects an amount with more than 7 decimal places', () => {
    expect(() => assert('1.00000001', ValidStellarAmountStruct)).toThrow(
      StructError,
    );
  });
});

describe('NonZeroValidSetllarAmountStruct', () => {
  it('accepts a valid non-zero amount', () => {
    expect(() =>
      assert('0.0000001', NonZeroValidSetllarAmountStruct),
    ).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => assert('0', NonZeroValidSetllarAmountStruct)).toThrow(
      StructError,
    );
    expect(() => assert('0.0000000', NonZeroValidSetllarAmountStruct)).toThrow(
      StructError,
    );
  });
});
