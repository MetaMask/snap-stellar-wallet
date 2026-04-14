import { batchesAllSettled, chunks } from './async';

describe('batchesAllSettled', () => {
  it('throws when batchSize is less than 1', async () => {
    const run = async () => batchesAllSettled([1], 0, async (value) => value);
    await expect(run()).rejects.toThrow(RangeError);
  });

  it('returns empty array for empty items', async () => {
    const result = await batchesAllSettled([], 3, async () => 0);
    expect(result).toStrictEqual([]);
  });

  it('preserves order and aligns results with items', async () => {
    const items = ['a', 'b', 'c'];
    const settled = await batchesAllSettled(items, 2, async (item) =>
      item.toUpperCase(),
    );

    expect(settled).toHaveLength(3);
    expect(settled[0]).toStrictEqual({ status: 'fulfilled', value: 'A' });
    expect(settled[1]).toStrictEqual({ status: 'fulfilled', value: 'B' });
    expect(settled[2]).toStrictEqual({ status: 'fulfilled', value: 'C' });
  });

  it('passes global index to mapper', async () => {
    const settled = await batchesAllSettled(
      ['x', 'y'],
      5,
      async (_item, i) => i,
    );
    expect(settled[0]).toStrictEqual({ status: 'fulfilled', value: 0 });
    expect(settled[1]).toStrictEqual({ status: 'fulfilled', value: 1 });
  });

  it('records rejected promises without failing the whole batch', async () => {
    const fns = [
      async () => 10,
      async () => {
        throw new Error('boom');
      },
      async () => 90,
    ];

    const settled = await batchesAllSettled(fns, 2, async (fn) => fn());

    expect(settled[0]).toStrictEqual({ status: 'fulfilled', value: 10 });
    expect(settled[1]).toMatchObject({ status: 'rejected' });
    expect(settled[2]).toStrictEqual({ status: 'fulfilled', value: 90 });
  });

  it('limits concurrency to batchSize across waves', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5];

    await batchesAllSettled(items, 2, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
      concurrent -= 1;
      return 0;
    });

    expect(maxConcurrent).toBe(2);
  });
});

describe('chunks', () => {
  it('returns empty array for empty items', () => {
    const result = chunks([], 3);
    expect(result).toStrictEqual([]);
  });

  it('returns single chunk for items less than chunk size', () => {
    const result = chunks(['a', 'b', 'c'], 4);
    expect(result).toStrictEqual([['a', 'b', 'c']]);
  });

  it('returns multiple chunks for items greater than chunk size', () => {
    const result = chunks(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      3,
    );
    expect(result).toStrictEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
      ['j'],
    ]);
  });
});
