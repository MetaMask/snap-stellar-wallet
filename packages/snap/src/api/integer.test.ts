import { assert, StructError } from '@metamask/superstruct';

import {
  NonZeroValidAmountStruct,
  PositiveNumberStringStruct,
  ValidAmountStruct,
} from './integer';

describe('PositiveNumberStringStruct', () => {
  it('accepts a valid positive integer string', () => {
    expect(() =>
      assert('1000000000', PositiveNumberStringStruct),
    ).not.toThrow();
  });

  it('accepts a valid positive float string', () => {
    expect(() => assert('1.5', PositiveNumberStringStruct)).not.toThrow();
  });

  it('rejects JavaScript bigint', () => {
    expect(() => assert(BigInt(100), PositiveNumberStringStruct)).toThrow(
      StructError,
    );
  });

  it('rejects a negative numeric string', () => {
    expect(() => assert('-1', PositiveNumberStringStruct)).toThrow(StructError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => assert('not-a-number', PositiveNumberStringStruct)).toThrow(
      StructError,
    );
  });
});

describe('ValidAmountStruct', () => {
  it('accepts a valid amount with up to 7 decimal places', () => {
    expect(() => assert('12.3456789', ValidAmountStruct)).not.toThrow();
  });

  it('accepts max int64 represented in 7-decimal Stellar units', () => {
    // MAX_INT64 stroops converted to XLM-style amount.
    expect(() =>
      assert('922337203685.4775807', ValidAmountStruct),
    ).not.toThrow();
  });

  it('rejects an amount above max int64 when converted to stroops', () => {
    expect(() => assert('922337203685.4775808', ValidAmountStruct)).toThrow(
      StructError,
    );
  });

  it('rejects an amount with more than 7 decimal places', () => {
    expect(() => assert('1.00000001', ValidAmountStruct)).toThrow(StructError);
  });

  it('rejects a negative amount', () => {
    expect(() => assert('-0.1', ValidAmountStruct)).toThrow(StructError);
  });

  it('rejects non-finite numeric values', () => {
    expect(() => assert('Infinity', ValidAmountStruct)).toThrow(StructError);
    expect(() => assert('NaN', ValidAmountStruct)).toThrow(StructError);
  });
});

describe('NonZeroValidAmountStruct', () => {
  it('accepts a valid non-zero amount', () => {
    expect(() => assert('0.0000001', NonZeroValidAmountStruct)).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => assert('0', NonZeroValidAmountStruct)).toThrow(StructError);
    expect(() => assert('0.0000000', NonZeroValidAmountStruct)).toThrow(
      StructError,
    );
  });
});
