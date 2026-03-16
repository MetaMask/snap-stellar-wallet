import { getLowestIndex } from './number';

describe('getLowestIndex', () => {
  it('returns 0 if the array is empty', () => {
    expect(getLowestIndex([])).toBe(0);
  });

  it('returns the lowest index that is not in the array (gap at the end)', () => {
    expect(getLowestIndex([0, 1, 2, 3])).toBe(4);
  });

  it('returns the lowest index from the gap that is not in the array', () => {
    const data = Array.from({ length: 1000 }, (_, index) => index);
    const first = data.splice(0, 400);
    const second = data.splice(500, 400);

    expect(getLowestIndex(first.concat(second))).toBe(400);
  });

  it('returns the lowest index that is not in the array (gap at the beginning)', () => {
    expect(getLowestIndex([1, 2, 3])).toBe(0);
  });
});
