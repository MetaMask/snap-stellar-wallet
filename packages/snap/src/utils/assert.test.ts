import { isSameStr } from './assert';

describe('isSameStr', () => {
  it('returns true when strings differ only by case', () => {
    expect(isSameStr('Hello', 'hello')).toBe(true);
    expect(isSameStr('ABC', 'abc')).toBe(true);
  });

  it('returns true when strings are identical', () => {
    expect(isSameStr('same', 'same')).toBe(true);
  });

  it('returns false when strings differ beyond case', () => {
    expect(isSameStr('hello', 'world')).toBe(false);
    expect(isSameStr('a', 'b')).toBe(false);
  });
});
