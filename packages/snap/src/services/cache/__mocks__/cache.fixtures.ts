import type { Serializable } from '../../../utils/serialization';
import type { ICache } from '../api';

/**
 * In-memory {@link ICache} for tests (jest.fn wrappers + backing map).
 *
 * @returns Cache implementation and backing map for priming reads.
 */
export function createMemoryCache(): {
  cache: ICache<Serializable>;
  store: Map<string, Serializable>;
} {
  const store = new Map<string, Serializable>();
  const cache: ICache<Serializable> = {
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: Serializable) => {
      store.set(key, value);
    }),
    delete: jest.fn(async () => false),
    clear: jest.fn(async () => {
      store.clear();
    }),
    has: jest.fn(async () => false),
    keys: jest.fn(async () => [...store.keys()]),
    size: jest.fn(async () => store.size),
    peek: jest.fn(async (key: string) => store.get(key)),
    mget: jest.fn(async (keys: string[]) => {
      const result: Record<string, Serializable | undefined> = {};
      for (const key of keys) {
        result[key] = store.get(key);
      }
      return result;
    }),
    mset: jest.fn(
      async (
        entries: {
          key: string;
          value: Serializable;
          ttlMilliseconds?: number;
        }[],
      ) => {
        for (const { key, value } of entries) {
          if (value !== undefined) {
            store.set(key, value);
          }
        }
      },
    ),
    mdelete: jest.fn(async () => ({})),
  } as unknown as ICache<Serializable>;
  return { cache, store };
}
