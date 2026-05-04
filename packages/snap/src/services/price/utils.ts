import type { CaipAssetType } from '@metamask/utils';

import type { VsCurrencyParam } from './price-api/api';

/**
 * Shorthand method to generate the cache key
 *
 * @param cacheKeyPrefix - The prefix of the cache key.
 * @param tokenCaipAssetType - The CAIP asset type.
 * @param vsCurrency - The currency to convert the prices to.
 * @returns The cache key.
 */
export function toCacheKey(
  cacheKeyPrefix: string,
  tokenCaipAssetType: CaipAssetType,
  vsCurrency: VsCurrencyParam | string,
): string {
  return `${cacheKeyPrefix}:${tokenCaipAssetType}:${vsCurrency}`;
}

/**
 * Parses back the cache key
 *
 * @param cacheKeyPrefix - The prefix of the cache key.
 * @param key - The cache key to parse.
 * @returns The parsed cache key.
 */
export function parseCacheKey(
  cacheKeyPrefix: string,
  key: string,
): RegExpMatchArray {
  const regex = new RegExp(`^${cacheKeyPrefix}:(.+):(.+)$`, 'u');
  const match = key.match(regex);

  if (!match) {
    throw new Error('Invalid cache key');
  }

  return match;
}
