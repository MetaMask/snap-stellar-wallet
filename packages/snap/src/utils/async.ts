/**
 * Runs async work on items in fixed-size waves, using {@link Promise.allSettled} per wave.
 * The next wave starts only after the current one settles, limiting concurrency to `batchSize`.
 *
 * @param items - Input items; order is preserved in the returned results.
 * @param batchSize - Maximum concurrent mapper invocations per wave (must be ≥ 1).
 * @param mapper - Async function for each item; receives the global index in `items`.
 * @returns One settled result per item, in the same order as `items`.
 */
export async function batchesAllSettled<TItem, TResult>(
  items: readonly TItem[],
  batchSize: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
  if (batchSize < 1) {
    throw new RangeError('batchSize must be at least 1');
  }

  const results: PromiseSettledResult<TResult>[] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (item, batchOffset) => mapper(item, index + batchOffset)),
    );
    results.push(...settled);
  }

  return results;
}
