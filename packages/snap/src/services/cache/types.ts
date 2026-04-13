import type { Serializable } from '../../utils/serialization';

export type TimestampMilliseconds = number;

/**
 * A single cache entry.
 */
export type CacheEntry = {
  value: Serializable;
  expiresAt: TimestampMilliseconds;
};
