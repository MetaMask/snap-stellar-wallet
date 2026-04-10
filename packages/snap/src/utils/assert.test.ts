import { assertIsSameStr } from './assert';

describe('assertIsSameStr', () => {
  it('returns true when strings differ only by case', () => {
    expect(assertIsSameStr('Hello', 'hello')).toBe(true);
    expect(assertIsSameStr('ABC', 'abc')).toBe(true);
  });

  it('returns true when strings are identical', () => {
    expect(assertIsSameStr('same', 'same')).toBe(true);
  });

  it('returns false when strings differ beyond case', () => {
    expect(assertIsSameStr('hello', 'world')).toBe(false);
    expect(assertIsSameStr('a', 'b')).toBe(false);
  });
});
