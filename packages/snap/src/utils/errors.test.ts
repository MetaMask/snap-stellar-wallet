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
  formatKeyringHandlerError,
  withCatchAndThrowSnapError,
  isSnapRpcError,
  sanitizeSensitiveError,
} from './errors';
import { logger } from './logger';

jest.mock('./logger');

describe('errors', () => {
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatKeyringHandlerError', () => {
    it('includes JSON-RPC code and data when message is generic', () => {
      const err = {
        message: 'Unknown error',
        code: -32603,
        data: { reason: 'assertAccountCanBeUsed failed' },
      };

      expect(formatKeyringHandlerError(err)).toBe(
        'Unknown error | code=-32603 | data={"reason":"assertAccountCanBeUsed failed"}',
      );
    });

    it('returns the message for a normal Error', () => {
      expect(formatKeyringHandlerError(new Error('Something broke'))).toBe(
        'Something broke',
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

  describe('sanitizeSensitiveError', () => {
    describe('when the error message contains sensitive information', () => {
      it('masks sensitive information in the error message', () => {
        const error = new Error(
          'Test error with private key 0x1234567890abcdef',
        );
        const sanitizedError = sanitizeSensitiveError(error);

        expect(sanitizedError.message).toBe(
          'Key derivation failed. Please check your connection and try again.',
        );
        expect(sanitizedError.name).toStrictEqual(error.name);
        expect(sanitizedError.cause).toStrictEqual(error.cause);
        expect(sanitizeSensitiveError(error)).toBeInstanceOf(Error);
      });

      it('masks sensitive information in the error message and preserves the original error type if it is a Snap error', () => {
        const error = new SnapError(
          'Test error with private key 0x1234567890abcdef',
          { code: 1234567890 },
        );
        const sanitizedError = sanitizeSensitiveError(error);

        expect(sanitizedError.message).toBe(
          'Key derivation failed. Please check your connection and try again.',
        );
        expect(sanitizedError.name).toStrictEqual(error.name);
        expect(sanitizedError.cause).toStrictEqual(error.cause);
        expect(sanitizeSensitiveError(error)).toBeInstanceOf(SnapError);
      });

      it('returns generic Error when Snap error has no constructor (e.g. exotic or cross-realm object)', () => {
        // SnapError with constructor removed so we hit the fallback branch
        const error = new SnapError('secret key leaked', { code: 1234567890 });
        Object.defineProperty(error, 'constructor', {
          value: undefined,
          configurable: true,
        });

        expect(isSnapRpcError(error)).toBe(true);
        expect(error.constructor).toBeUndefined();

        const sanitizedError = sanitizeSensitiveError(error);

        expect(sanitizedError.message).toBe(
          'Key derivation failed. Please check your connection and try again.',
        );
        expect(sanitizedError).toBeInstanceOf(Error);
        expect(sanitizedError).not.toBeInstanceOf(SnapError);
      });
    });

    describe('when the error message does not contain sensitive information', () => {
      it('does not mask sensitive information in the error message', () => {
        const error = new Error('Test error');
        const sanitizedError = sanitizeSensitiveError(error);

        expect(sanitizedError.message).toBe('Test error');
        expect(sanitizedError.name).toStrictEqual(error.name);
        expect(sanitizedError.cause).toStrictEqual(error.cause);
        expect(sanitizeSensitiveError(error)).toBeInstanceOf(Error);
      });
    });
  });
});
