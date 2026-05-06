import {
  batchesAll,
  batchesAllSettled,
  batchesAllSettledWithChunks,
  batchesAllWithChunks,
  chunks,
} from './async';

describe('batchesAll', () => {
  it('throws when batchSize is less than 1', async () => {
    const run = async () => batchesAll([1], 0, async (value) => value);
    await expect(run()).rejects.toThrow(RangeError);
  });

  it('returns empty array for empty items', async () => {
    const result = await batchesAll([], 3, async () => 0);
    expect(result).toStrictEqual([]);
  });

  it('preserves order and aligns results with items', async () => {
    const items = ['a', 'b', 'c'];
    const results = await batchesAll(items, 2, async (item) =>
      item.toUpperCase(),
    );

    expect(results).toStrictEqual(['A', 'B', 'C']);
  });

  it('passes global index to mapper', async () => {
    const results = await batchesAll(['x', 'y'], 5, async (_item, i) => i);
    expect(results).toStrictEqual([0, 1]);
  });

  it('rejects when any mapper rejects', async () => {
    const mapper = jest
      .fn()
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(30);

    await expect(batchesAll([1, 2, 3], 2, mapper)).rejects.toThrow('boom');
  });

  it('limits concurrency to batchSize across waves', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5];

    await batchesAll(items, 2, async () => {
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

  it('throws when chunkSize is less than 1', () => {
    const run = () => chunks(['a', 'b', 'c'], 0);
    expect(run).toThrow(RangeError);
  });
});

describe('batchesAllSettledWithChunks', () => {
  it('returns empty array for empty items', async () => {
    const result = await batchesAllSettledWithChunks([], 2, 3, async () => 0);
    expect(result).toStrictEqual([]);
  });

  it('maps each chunk and preserves chunk order in settled results', async () => {
    const settled = await batchesAllSettledWithChunks(
      ['a', 'b', 'c', 'd'],
      2,
      2,
      async (chunk, chunkIndex) => ({ chunkIndex, joined: chunk.join('') }),
    );

    expect(settled).toHaveLength(2);
    expect(settled[0]).toStrictEqual({
      status: 'fulfilled',
      value: { chunkIndex: 0, joined: 'ab' },
    });
    expect(settled[1]).toStrictEqual({
      status: 'fulfilled',
      value: { chunkIndex: 1, joined: 'cd' },
    });
  });

  it('records rejected chunk without failing other chunks', async () => {
    const mapper = jest
      .fn()
      .mockRejectedValueOnce(new Error('chunk0 fail'))
      .mockResolvedValueOnce(7);

    const settled = await batchesAllSettledWithChunks(
      [1, 2, 3, 4],
      2,
      1,
      mapper,
    );

    expect(mapper).toHaveBeenNthCalledWith(1, [1, 2], 0);
    expect(mapper).toHaveBeenNthCalledWith(2, [3, 4], 1);
    expect(settled[0]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'chunk0 fail' }),
    });
    expect(settled[1]).toStrictEqual({ status: 'fulfilled', value: 7 });
  });
});

describe('batchesAllWithChunks', () => {
  it('returns empty array for empty items', async () => {
    const result = await batchesAllWithChunks([], 2, 3, async () => 0);
    expect(result).toStrictEqual([]);
  });

  it('maps each chunk and preserves chunk order', async () => {
    const results = await batchesAllWithChunks(
      ['a', 'b', 'c', 'd'],
      2,
      2,
      async (chunk, chunkIndex) => ({ chunkIndex, joined: chunk.join('') }),
    );

    expect(results).toStrictEqual([
      { chunkIndex: 0, joined: 'ab' },
      { chunkIndex: 1, joined: 'cd' },
    ]);
  });

  it('rejects when any chunk mapper rejects', async () => {
    const mapper = jest
      .fn()
      .mockRejectedValueOnce(new Error('chunk0 fail'))
      .mockResolvedValueOnce(7);

    await expect(
      batchesAllWithChunks([1, 2, 3, 4], 2, 1, mapper),
    ).rejects.toThrow('chunk0 fail');
  });
});
