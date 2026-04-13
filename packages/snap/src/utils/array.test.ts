import { entries, keys, values } from './array';

describe('entries', () => {
  it('returns key-value tuples for a partial record', () => {
    const obj = { a: 1, b: 2 } as const;
    const result = entries(obj);
    expect(result).toStrictEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('returns an empty array for an empty object', () => {
    expect(entries({})).toStrictEqual([]);
  });
});

describe('keys', () => {
  it('returns object keys as a typed array', () => {
    const obj = { x: 1, y: 2 };
    expect(keys(obj).sort()).toStrictEqual(['x', 'y']);
  });

  it('returns an empty array when the object has no keys', () => {
    expect(keys({})).toStrictEqual([]);
  });
});

describe('values', () => {
  it('returns object values in insertion order', () => {
    const obj = { first: 'a', second: 'b' };
    expect(values(obj)).toStrictEqual(['a', 'b']);
  });

  it('returns an empty array when the object has no values', () => {
    expect(values({})).toStrictEqual([]);
  });
});
