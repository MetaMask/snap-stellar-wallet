import { assert, StructError } from '@metamask/superstruct';

import { PositiveNumberStringStruct } from './integer';

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
