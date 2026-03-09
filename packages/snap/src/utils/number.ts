/**
 * This function finds the lowest index in a sorted array of numbers.
 *
 * @param sortedIndices - The sorted array of non-negative numbers to check.
 * @returns The lowest unused index.
 */
export function getLowestIndex(sortedIndices: number[]): number {
  const { length } = sortedIndices;
  // Find the smallest i (0 <= i <= n) such that sortedIndices[i] > i (treat i === n as gap).
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const value = sortedIndices[mid];
    if (value !== undefined && value > mid) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}
