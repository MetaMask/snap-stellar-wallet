import type { ICache } from './api';
import {
  useCacheUntil,
  type CacheUntilOptions,
  type ResultWithExpiry,
} from './useCacheUntil';
import type { Serializable } from '../../utils/serialization';

jest.mock('../../utils/logger');

describe('useCacheUntil', () => {
  // Spy to check if the original function was executed or not
  let actualExecutionSpy: jest.Mock;

  // Mock cache
  let cache: ICache<Serializable>;

  // Common cache options
  let cacheOptions: CacheUntilOptions;

  // Original test function that returns result with expiry
  let testFunction: () => Promise<ResultWithExpiry<string>>;
  let testFunctionWithArgs: (arg1: string) => Promise<ResultWithExpiry<string>>;

  // Cached versions
  let cachedTestFunction: () => Promise<string>;
  let cachedTestFunctionWithArgs: (arg1: string) => Promise<string>;

  // Mock current time
  const mockNow = 1700000000000; // Fixed timestamp for testing

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockNow);

    // Reset mocks for each test
    actualExecutionSpy = jest.fn().mockResolvedValue({
      result: 'test',
      expiresAt: mockNow + 60000, // Expires in 60 seconds
    });

    // Create a mock cache
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as ICache<Serializable>;

    // Define common cache options
    cacheOptions = {
      functionName: 'testFunction',
    };

    // Define original functions
    testFunction = async () => actualExecutionSpy();
    testFunctionWithArgs = async (arg1: string) => actualExecutionSpy(arg1);

    // Create cached versions
    cachedTestFunction = useCacheUntil(testFunction, cache, {
      ...cacheOptions,
      functionName: 'testFunction',
    });

    cachedTestFunctionWithArgs = useCacheUntil(testFunctionWithArgs, cache, {
      ...cacheOptions,
      functionName: 'testFunctionWithArgs',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('when the data is not cached', () => {
    it('caches the result with TTL calculated from expiresAt', async () => {
      // No cached data
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);

      const result = await cachedTestFunction();

      expect(result).toBe('test');
      expect(actualExecutionSpy).toHaveBeenCalledTimes(1);
      // TTL should be expiresAt - now = 60000
      expect(cache.set).toHaveBeenCalledWith('testFunction:', 'test', 60000);
    });

    it('uses zero TTL when expiresAt is in the past', async () => {
      actualExecutionSpy.mockResolvedValue({
        result: 'test',
        expiresAt: mockNow - 1000, // Already expired
      });

      const result = await cachedTestFunction();

      expect(result).toBe('test');
      // TTL should be 0 when expiresAt is in the past
      expect(cache.set).toHaveBeenCalledWith('testFunction:', 'test', 0);
    });
  });

  describe('when the data is cached and not expired', () => {
    it('returns the cached result without calling the function', async () => {
      // First call to populate the cache and expiry map
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      await cachedTestFunction();

      // Reset mocks
      actualExecutionSpy.mockClear();
      jest.spyOn(cache, 'get').mockResolvedValue('cached-test');

      // Second call within expiry period
      const result = await cachedTestFunction();

      expect(result).toBe('cached-test');
      expect(actualExecutionSpy).not.toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalledTimes(1); // Only from first call
    });
  });

  describe('when the data is cached but expired', () => {
    it('fetches fresh data after expiry time has passed', async () => {
      // First call to populate the cache
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      await cachedTestFunction();

      // Advance time past the expiry
      jest.setSystemTime(mockNow + 70000); // 70 seconds later

      // Reset mocks for second call
      actualExecutionSpy.mockClear();
      actualExecutionSpy.mockResolvedValue({
        result: 'fresh-test',
        expiresAt: mockNow + 70000 + 60000, // New expiry
      });

      const result = await cachedTestFunction();

      expect(result).toBe('fresh-test');
      expect(actualExecutionSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache key generation', () => {
    it('generates cache key with function name and arguments', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      actualExecutionSpy.mockResolvedValue({
        result: 'test with args',
        expiresAt: mockNow + 60000,
      });

      await cachedTestFunctionWithArgs('hello');

      expect(cache.set).toHaveBeenCalledWith(
        'testFunctionWithArgs:"hello"',
        'test with args',
        60000,
      );
    });

    it('uses a custom key generator if provided', async () => {
      const customKeyGenerator = jest.fn().mockReturnValue('custom-key');

      const customCachedFunction = useCacheUntil(testFunction, cache, {
        ...cacheOptions,
        generateCacheKey: customKeyGenerator,
      });

      await customCachedFunction();

      expect(customKeyGenerator).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith('custom-key', 'test', 60000);
    });
  });

  describe('error handling', () => {
    it('propagates errors from the original function', async () => {
      const error = new Error('Test error');
      actualExecutionSpy.mockRejectedValueOnce(error);

      await expect(cachedTestFunction()).rejects.toThrow('Test error');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('handles cache get errors gracefully', async () => {
      // First call to populate expiry map
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      await cachedTestFunction();

      // Reset for second call
      actualExecutionSpy.mockClear();
      jest.spyOn(cache, 'get').mockRejectedValueOnce(new Error('Cache error'));
      actualExecutionSpy.mockResolvedValue({
        result: 'test',
        expiresAt: mockNow + 60000,
      });

      const result = await cachedTestFunction();

      expect(result).toBe('test');
      expect(actualExecutionSpy).toHaveBeenCalledTimes(1);
    });

    it('handles cache set errors gracefully', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      jest
        .spyOn(cache, 'set')
        .mockRejectedValueOnce(new Error('Cache set error'));

      const result = await cachedTestFunction();

      expect(result).toBe('test');
      expect(actualExecutionSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('anonymous functions', () => {
    it('handles anonymous functions with a default name', async () => {
      const anonymousFunction = async (): Promise<ResultWithExpiry<string>> =>
        actualExecutionSpy();
      Object.defineProperty(anonymousFunction, 'name', { value: null });

      const cachedAnonymousFunction = useCacheUntil(anonymousFunction, cache, {
        // No functionName provided
      });

      await cachedAnonymousFunction();

      expect(cache.set).toHaveBeenCalledWith(
        'anonymousFunction:',
        'test',
        60000,
      );
    });
  });

  describe('function name override', () => {
    it('uses the provided function name if given', async () => {
      const cachedWithCustomName = useCacheUntil(testFunction, cache, {
        functionName: 'customFunctionName',
      });

      await cachedWithCustomName();

      expect(cache.set).toHaveBeenCalledWith(
        'customFunctionName:',
        'test',
        60000,
      );
    });
  });

  describe('falsy but valid cache values', () => {
    it('handles falsy but valid cache values (false, 0, empty string)', async () => {
      // First call to populate expiry map with false result
      actualExecutionSpy.mockResolvedValue({
        result: false,
        expiresAt: mockNow + 60000,
      });
      await cachedTestFunction();

      // Reset and set cache to return false
      actualExecutionSpy.mockClear();
      jest.spyOn(cache, 'get').mockResolvedValue(false);

      const result = await cachedTestFunction();

      expect(result).toBe(false);
      expect(actualExecutionSpy).not.toHaveBeenCalled();
    });

    it('executes the function when cache returns undefined', async () => {
      // First call to populate expiry map
      await cachedTestFunction();

      // Reset for second call with undefined cache
      actualExecutionSpy.mockClear();
      jest.spyOn(cache, 'get').mockResolvedValue(undefined);
      actualExecutionSpy.mockResolvedValue({
        result: 'fresh',
        expiresAt: mockNow + 60000,
      });

      const result = await cachedTestFunction();

      expect(result).toBe('fresh');
      expect(actualExecutionSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('maintenance-aligned caching scenario', () => {
    it('caches until exact maintenance time and refetches after', async () => {
      const maintenanceTime = mockNow + 6 * 60 * 60 * 1000; // 6 hours from now

      actualExecutionSpy.mockResolvedValue({
        result: { energyFee: 420, transactionFee: 1000 },
        expiresAt: maintenanceTime,
      });

      // First call - should fetch and cache
      await cachedTestFunction();

      expect(cache.set).toHaveBeenCalledWith(
        'testFunction:',
        { energyFee: 420, transactionFee: 1000 },
        6 * 60 * 60 * 1000, // 6 hours TTL
      );

      // Advance time to just before maintenance
      jest.setSystemTime(maintenanceTime - 1000);
      actualExecutionSpy.mockClear();
      jest
        .spyOn(cache, 'get')
        .mockResolvedValue({ energyFee: 420, transactionFee: 1000 });

      await cachedTestFunction();
      expect(actualExecutionSpy).not.toHaveBeenCalled(); // Still using cache

      // Advance time past maintenance
      jest.setSystemTime(maintenanceTime + 1000);
      actualExecutionSpy.mockResolvedValue({
        result: { energyFee: 500, transactionFee: 1200 }, // New values
        expiresAt: maintenanceTime + 6 * 60 * 60 * 1000, // Next maintenance
      });

      const freshResult = await cachedTestFunction();

      expect(actualExecutionSpy).toHaveBeenCalledTimes(1); // Fetched fresh
      expect(freshResult).toStrictEqual({
        energyFee: 500,
        transactionFee: 1200,
      });
    });
  });
});
