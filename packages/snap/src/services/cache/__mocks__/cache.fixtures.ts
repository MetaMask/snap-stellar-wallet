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
    mget: jest.fn(async () => ({})),
    mset: jest.fn(async () => undefined),
    mdelete: jest.fn(async () => ({})),
  } as unknown as ICache<Serializable>;
  return { cache, store };
}
