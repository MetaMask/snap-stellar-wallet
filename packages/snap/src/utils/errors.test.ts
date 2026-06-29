import {
  ChainDisconnectedError,
  DisconnectedError,
  InternalError,
  InvalidInputError,
  InvalidParamsError,
  InvalidRequestError,
  LimitExceededError,
  MethodNotFoundError,
  MethodNotSupportedError,
  ParseError,
  ResourceNotFoundError,
  ResourceUnavailableError,
  SnapError,
  TransactionRejected,
  UnauthorizedError,
  UnsupportedMethodError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';

import {
  HttpException,
  HttpResponseException,
  InvalidHttpRequestParamsException,
  isSnapRpcError,
  rethrowIfInstanceElseThrow,
  trackErrorIfNeeded,
  withCatchAndThrowSnapError,
} from './errors';
import { logger } from './logger';
import * as snapUtils from './snap';

jest.mock('./logger');
jest.mock('./snap');

describe('errors', () => {
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rethrowIfInstanceElseThrow', () => {
    class SampleDomainError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'SampleDomainError';
      }
    }

    class SampleDomainSubError extends SampleDomainError {}

    class OtherDomainError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'OtherDomainError';
      }
    }

    it('rethrows when error matches the sole constructor in the list', () => {
      const original = new SampleDomainError('preserved');
      expect(() =>
        rethrowIfInstanceElseThrow(
          original,
          [SampleDomainError],
          new SampleDomainError('fallback'),
        ),
      ).toThrow(original);
    });

    it('rethrows subclass instances as the base class match', () => {
      const sub = new SampleDomainSubError('sub');
      expect(() =>
        rethrowIfInstanceElseThrow(
          sub,
          [SampleDomainError],
          new SampleDomainError('fallback'),
        ),
      ).toThrow(sub);
    });

    it('throws fallback when error is not an instance of any listed class', () => {
      expect(() =>
        rethrowIfInstanceElseThrow(
          new Error('generic'),
          [SampleDomainError],
          new SampleDomainError('wrapped'),
        ),
      ).toThrow(
        expect.objectContaining({
          name: 'SampleDomainError',
          message: 'wrapped',
        }),
      );
    });

    it('rethrows when error matches any constructor in the list', () => {
      const firstMatch = new SampleDomainError('first');
      expect(() =>
        rethrowIfInstanceElseThrow(
          firstMatch,
          [SampleDomainError, OtherDomainError],
          new SampleDomainError('fallback'),
        ),
      ).toThrow(firstMatch);

      const secondMatch = new OtherDomainError('second');
      expect(() =>
        rethrowIfInstanceElseThrow(
          secondMatch,
          [SampleDomainError, OtherDomainError],
          new SampleDomainError('fallback'),
        ),
      ).toThrow(secondMatch);
    });

    it('throws fallback when error matches none of the constructors', () => {
      expect(() =>
        rethrowIfInstanceElseThrow(
          new Error('generic'),
          [SampleDomainError, OtherDomainError],
          new SampleDomainError('wrapped'),
        ),
      ).toThrow(
        expect.objectContaining({
          name: 'SampleDomainError',
          message: 'wrapped',
        }),
      );
    });
  });

  describe('withCatchAndThrowSnapError', () => {
    it('returns the result when the function succeeds', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');

      const result = await withCatchAndThrowSnapError(mockFn);

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('handles and re-throws errors as SnapError', async () => {
      const originalError = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(originalError);

      await expect(withCatchAndThrowSnapError(mockFn)).rejects.toThrow(
        SnapError,
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('logs errors with the correct scope and error details', async () => {
      const originalError = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(originalError);

      try {
        await withCatchAndThrowSnapError(mockFn);
      } catch {
        // Expected to throw
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(SnapError) },
        expect.stringContaining(`[SnapError]`),
      );

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const logCall = mockLogger.error.mock.calls[0];
      const loggedError = logCall?.[0] as { error: SnapError };
      expect(loggedError.error).toBeInstanceOf(SnapError);
    });

    it('handles non-Error objects and converts them to SnapError', async () => {
      const nonErrorValue = 'string error';
      const mockFn = jest.fn().mockRejectedValue(nonErrorValue);

      await expect(withCatchAndThrowSnapError(mockFn)).rejects.toThrow(
        SnapError,
      );

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const logCall = mockLogger.error.mock.calls[0];
      const loggedError = logCall?.[0] as { error: SnapError };
      expect(loggedError.error).toBeInstanceOf(SnapError);
    });

    it('handles null and undefined errors', async () => {
      const mockFn = jest.fn().mockRejectedValue(null);

      await expect(withCatchAndThrowSnapError(mockFn)).rejects.toThrow(
        SnapError,
      );

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('preserves the original error message in the SnapError', async () => {
      const originalError = new Error('Custom error message');
      const mockFn = jest.fn().mockRejectedValue(originalError);

      let caughtError: unknown;
      try {
        await withCatchAndThrowSnapError(mockFn);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(SnapError);
      const snapError = caughtError as SnapError;
      expect(snapError.message).toBe('Custom error message');
    });

    it('handles async functions that return different types', async () => {
      const testCases = [
        { value: 42, type: 'number' },
        { value: { key: 'value' }, type: 'object' },
        { value: [1, 2, 3], type: 'array' },
        { value: true, type: 'boolean' },
        { value: null, type: 'null' },
      ];

      for (const testCase of testCases) {
        const mockFn = jest.fn().mockResolvedValue(testCase.value);

        const result = await withCatchAndThrowSnapError(mockFn);

        expect(result).toBe(testCase.value);
        expect(mockLogger.error).not.toHaveBeenCalled();
      }
    });

    it('handles functions that throw different error types', async () => {
      const errorTypes = [
        new TypeError('Type error'),
        new ReferenceError('Reference error'),
        new RangeError('Range error'),
        new SyntaxError('Syntax error'),
      ];

      for (const errorType of errorTypes) {
        const mockFn = jest.fn().mockRejectedValue(errorType);

        await expect(withCatchAndThrowSnapError(mockFn)).rejects.toThrow(
          SnapError,
        );
      }

      expect(mockLogger.error).toHaveBeenCalledTimes(errorTypes.length);
      const logCalls = mockLogger.error.mock.calls;
      expect(logCalls).toHaveLength(errorTypes.length);

      for (let i = 0; i < errorTypes.length; i++) {
        const logCall = logCalls[i];
        const loggedError = logCall?.[0] as { error: SnapError };
        expect(loggedError.error).toBeInstanceOf(SnapError);
        expect(loggedError.error.message).toBe(errorTypes[i]?.message);
      }
    });

    it('includes error stack trace in the logged error', async () => {
      const originalError = new Error('Test error');
      originalError.stack = 'Error: Test error\n    at test.js:1:1';
      const mockFn = jest.fn().mockRejectedValue(originalError);

      try {
        await withCatchAndThrowSnapError(mockFn);
      } catch {
        // Expected to throw
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(SnapError) },
        expect.stringContaining('[SnapError]'),
      );
    });

    it('handles functions that throw promises', async () => {
      const rejectedPromise = Promise.reject(new Error('Promise error'));
      const mockFn = jest.fn().mockImplementation(async () => rejectedPromise);

      await expect(withCatchAndThrowSnapError(mockFn)).rejects.toThrow(
        SnapError,
      );

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('isSnapRpcError', () => {
    it.each([
      new SnapError('Test error'),
      new MethodNotFoundError(),
      new UserRejectedRequestError(),
      new MethodNotSupportedError(),
      new ParseError(),
      new ResourceNotFoundError(),
      new ResourceUnavailableError(),
      new TransactionRejected(),
      new ChainDisconnectedError(),
      new DisconnectedError(),
      new UnauthorizedError(),
      new UnsupportedMethodError(),
      new InternalError(),
      new InvalidInputError(),
      new InvalidParamsError(),
      new InvalidRequestError(),
      new LimitExceededError(),
    ])('return true if the error is $error', (error) => {
      expect(isSnapRpcError(error)).toBe(true);
    });
  });

  describe('trackErrorIfNeeded', () => {
    let trackErrorSpy: jest.SpiedFunction<typeof snapUtils.trackError>;

    beforeEach(() => {
      trackErrorSpy = jest
        .spyOn(snapUtils, 'trackError')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      trackErrorSpy.mockRestore();
    });

    it('does not call trackError for HttpException', async () => {
      await trackErrorIfNeeded(new HttpException('network down'));

      expect(trackErrorSpy).not.toHaveBeenCalled();
    });

    it('does not call trackError for HttpResponseException', async () => {
      await trackErrorIfNeeded(new HttpResponseException(503));

      expect(trackErrorSpy).not.toHaveBeenCalled();
    });

    it('does not call trackError for fetch transport errors', async () => {
      const fetchError = new Error('fetch failed');
      Object.assign(fetchError, { cause: { code: 'ECONNREFUSED' } });

      await trackErrorIfNeeded(fetchError);

      expect(trackErrorSpy).not.toHaveBeenCalled();
    });

    it('does not call trackError for UserRejectedRequestError', async () => {
      await trackErrorIfNeeded(new UserRejectedRequestError());

      expect(trackErrorSpy).not.toHaveBeenCalled();
    });

    it('calls trackError for unexpected errors', async () => {
      const error = new Error('unexpected');

      await trackErrorIfNeeded(error);

      expect(trackErrorSpy).toHaveBeenCalledWith(error);
    });

    it('calls trackError for InvalidHttpRequestParamsException', async () => {
      const error = new InvalidHttpRequestParamsException('bad params');

      await trackErrorIfNeeded(error);

      expect(trackErrorSpy).toHaveBeenCalledWith(error);
    });
  });
});
