import type { ICache } from './api';
import { createPrefixedLogger, logger } from '../../utils/logger';
import { serialize, type Serializable } from '../../utils/serialization';

const cacheLogger = createPrefixedLogger(logger, 'useCache');

/**
 * Result type for functions that provide their own expiry time.
 */
export type ResultWithExpiry<TResult> = {
  result: TResult;
  expiresAt: number; // Unix timestamp in milliseconds
};

/**
 * Options for configuring the caching behavior of a function with dynamic expiry.
 */
export type CacheUntilOptions = {
  /**
   * Set this if you want to use a custom function name for the cache key.
   */
  functionName?: string;
  /**
   * Optional function to generate the cache key for the function call.
   * Defaults to a function that generates the key based on function name and JSON stringified args separated by colons.
   */
  generateCacheKey?: (functionName: string, args: Serializable[]) => string;

  /**
   * Whether to refresh the cache.
   * Defaults to false.
   */
  refreshCache?: boolean;
};

/**
 * Default function to generate the cache key for a function call.
 *
 * @param functionName - The name of the function.
 * @param args - The arguments of the function call.
 * @returns The cache key.
 */
const defaultGenerateCacheKey = (
  functionName: string,
  args: Serializable[],
): string =>
  `${functionName}:${args.map((arg) => JSON.stringify(serialize(arg))).join(':')}`;

/**
 * Wraps an async function with caching behavior where expiry is determined
 * by the function result itself (dynamic TTL).
 *
 * Unlike `useCache` which uses a fixed TTL, this utility allows the wrapped
 * function to specify when its result expires. This is useful for caching
 * data that has known invalidation points (e.g., blockchain maintenance periods).
 *
 * @template TArgs - Tuple type representing the arguments of the function.
 * @template TResult - The return type of the function, must be Serializable.
 * @param fn - The asynchronous function to wrap. Must return a Promise<ResultWithExpiry<TResult>>.
 * @param cache - The cache instance to use.
 * @param options - The caching options.
 * @param options.refreshCache - Whether to refresh the cache.
 * @param options.functionName - The name of the function.
 * @param options.generateCacheKey - Optional function to generate the cache key.
 * @returns A new asynchronous function with caching behavior.
 */
export const useCacheUntil = <
  TArgs extends Serializable[],
  TResult extends Serializable,
>(
  fn: (...args: TArgs) => Promise<ResultWithExpiry<TResult>>,
  cache: ICache<Serializable>,
  { functionName, generateCacheKey, refreshCache = false }: CacheUntilOptions,
): ((...args: TArgs) => Promise<TResult>) => {
  // Use provided key generator or default, adapting the default to use the function's name
  const _generateCacheKey = generateCacheKey ?? defaultGenerateCacheKey;

  // Get the function name for the default key generator, handle anonymous functions
  const _functionName = functionName ?? fn.name ?? 'anonymousFunction';

  // Map to track expiry timestamps for each cache key
  const expiryMap = new Map<string, number>();

  return async (...args: TArgs): Promise<TResult> => {
    const cacheKey = _generateCacheKey(_functionName, args);
    const now = Date.now();

    // Check if cached and not expired
    const expiresAt = expiryMap.get(cacheKey);
    if (!refreshCache && expiresAt !== undefined && now < expiresAt) {
      try {
        const cached = await cache.get(cacheKey);
        // Check explicitly for undefined, as null or other falsy values might be valid cache results
        if (cached !== undefined) {
          // Type assertion because cache stores Serializable, but we expect TResult
          return cached as TResult;
        }
      } catch (error) {
        // Log cache get errors but proceed to execute the function
        cacheLogger.error(`Cache get error for key "${cacheKey}":`, error);
      }
    }

    // Execute the original function to get result and new expiry
    const { result, expiresAt: newExpiresAt } = await fn(...args);

    // Calculate TTL from expiry timestamp
    const ttlMilliseconds = Math.max(0, newExpiresAt - now);

    // Store result in cache with calculated TTL
    await cache.set(cacheKey, result, ttlMilliseconds).catch((error) => {
      cacheLogger.error(`Cache set error for key "${cacheKey}":`, error);
    });

    // Store expiry timestamp
    expiryMap.set(cacheKey, newExpiresAt);

    return result;
  };
};
