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
import type { Struct } from '@metamask/superstruct';
import { assert, enums, object, type } from '@metamask/superstruct';

import type { ILogger } from './logger';
import { logger as defaultLogger } from './logger';
import { trackError } from './snap';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept arbitrary `Error` subclass ctor signatures
export type AnyErrorConstructor = abstract new (...args: any[]) => Error;

/**
 * Re-throws `error` when it is an instance of **any** constructor in `exceptionClasses` (subclasses
 * count). Otherwise throws `fallback`. Typical use after logging in an API client `catch` so known
 * domain errors propagate unchanged. Use a one-element array when only one type should match.
 *
 * @param error - Value from a `catch` clause.
 * @param exceptionClasses - `Error` subclass constructors to match with `instanceof`, in order.
 * @param fallback - Error to throw when nothing matches.
 */
export function rethrowIfInstanceElseThrow<Err extends Error>(
  error: unknown,
  exceptionClasses: readonly AnyErrorConstructor[],
  fallback: Err,
): never {
  for (const ExceptionClass of exceptionClasses) {
    if (error instanceof ExceptionClass) {
      throw error;
    }
  }
  throw fallback;
}

/** Union of Snap RPC error instance types (for type narrowing). */
export type SnapRpcError =
  | InstanceType<typeof SnapError>
  | InstanceType<typeof MethodNotFoundError>
  | InstanceType<typeof UserRejectedRequestError>
  | InstanceType<typeof MethodNotSupportedError>
  | InstanceType<typeof ParseError>
  | InstanceType<typeof ResourceNotFoundError>
  | InstanceType<typeof ResourceUnavailableError>
  | InstanceType<typeof TransactionRejected>
  | InstanceType<typeof ChainDisconnectedError>
  | InstanceType<typeof DisconnectedError>
  | InstanceType<typeof UnauthorizedError>
  | InstanceType<typeof UnsupportedMethodError>
  | InstanceType<typeof InternalError>
  | InstanceType<typeof InvalidInputError>
  | InstanceType<typeof InvalidParamsError>
  | InstanceType<typeof InvalidRequestError>
  | InstanceType<typeof LimitExceededError>;

/**
 * Determines if the given error is a Snap RPC error.
 *
 * @param error - The error instance to be checked.
 * @returns A boolean indicating whether the error is a Snap RPC error.
 */
export function isSnapRpcError(error: Error): error is SnapRpcError {
  const errors = [
    SnapError,
    MethodNotFoundError,
    UserRejectedRequestError,
    MethodNotSupportedError,
    ParseError,
    ResourceNotFoundError,
    ResourceUnavailableError,
    TransactionRejected,
    ChainDisconnectedError,
    DisconnectedError,
    UnauthorizedError,
    UnsupportedMethodError,
    InternalError,
    InvalidInputError,
    InvalidParamsError,
    InvalidRequestError,
    LimitExceededError,
  ];
  return errors.some((errType) => error instanceof errType);
}

export type StellarSnapExceptionOptions = {
  cause?: unknown;
  data?: Record<string, unknown>;
};

/**
 * A custom error class that extends the built-in Error class and adds a `data` property.
 * Instances are serialized by {@link trackError} / `snap_trackError` and forwarded to
 * MetaMask's Sentry pipeline, which applies platform-side scrubbing of sensitive fields.
 */
export class StellarSnapException extends Error {
  readonly data?: Record<string, unknown>;

  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.data = options?.data;

    // Explicitly hides this constructor from the stack trace if supported.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Network and transport error codes commonly surfaced by `fetch`. */
const COMMON_HTTP_ERROR_CODES = [
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_GET_ISSUER_CERT_LOC',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'AbortError',
] as const;

type CommonHttpErrorCode = (typeof COMMON_HTTP_ERROR_CODES)[number];

const COMMON_HTTP_ERROR_CODE_SET = new Set<string>(COMMON_HTTP_ERROR_CODES);

const CommonHttpErrorCodesStruct = object({
  cause: type({
    code: enums([...COMMON_HTTP_ERROR_CODES]),
  }),
});

/** Base for HTTP API client errors (transport, request shape, response shape). */
export class ApiException extends StellarSnapException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, options);
    this.name = 'ApiException';
  }
}

/** Network-level HTTP failure (timeout, DNS, TLS, abort, etc.). */
export class HttpException extends ApiException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, options);
    this.name = 'HttpException';
  }
}

/** Non-success HTTP status from a completed response. */
export class HttpResponseException extends HttpException {
  constructor(statusCode: number, options?: StellarSnapExceptionOptions) {
    super(`HTTP error! status: ${statusCode}`, options);
    this.name = 'HttpResponseException';
  }
}

/** Request parameters failed validation before the HTTP call. */
export class InvalidHttpRequestParamsException extends ApiException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, options);
    this.name = 'InvalidHttpRequestParamsException';
  }
}

/** Response body failed validation after a successful HTTP status. */
export class InvalidHttpResponseException extends ApiException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, options);
    this.name = 'InvalidHttpResponseException';
  }
}

/**
 * Validates API request parameters and throws {@link InvalidHttpRequestParamsException} on failure.
 *
 * @param params - Request payload or query parameters to validate.
 * @param struct - Superstruct schema for the validated shape.
 */
export function assertHttpRequestParams<Validated>(
  params: unknown,
  struct: Struct<Validated>,
): asserts params is Validated {
  try {
    assert(params, struct);
  } catch (error) {
    throw new InvalidHttpRequestParamsException(
      'Invalid API request parameters',
      { cause: error },
    );
  }
}

/**
 * Validates an API response body and throws {@link InvalidHttpResponseException} on failure.
 *
 * @param response - Parsed response body to validate.
 * @param struct - Superstruct schema for `response`.
 */
export function assertHttpResponse<Response>(
  response: Response,
  struct: Struct<Response>,
): void {
  try {
    assert(response, struct);
  } catch (error) {
    throw new InvalidHttpResponseException('Invalid API response', {
      cause: error,
    });
  }
}

/**
 * @param error - Value from a `catch` clause.
 * @returns A known HTTP error code from `error.cause.code` or `error.code`.
 */
function getHttpErrorCode(error: Error): CommonHttpErrorCode | undefined {
  if (CommonHttpErrorCodesStruct.is(error)) {
    return error.cause?.code;
  }

  const { code } = error as { code?: string };
  return code !== undefined && COMMON_HTTP_ERROR_CODE_SET.has(code)
    ? (code as CommonHttpErrorCode)
    : undefined;
}

/**
 * Whether `error` represents a transient HTTP transport failure.
 * Used by API clients to decide between fail-fast and partial-result recovery.
 *
 * @param error - Value from a `catch` clause or rejected batch entry.
 * @returns `true` for network, timeout, abort, and non-2xx HTTP status errors.
 */
export function isHttpException(
  error: unknown,
): error is HttpException | (Error & { cause?: { code: string } }) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error instanceof HttpException) {
    return true;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  return getHttpErrorCode(error) !== undefined;
}

/**
 * Wraps raw transport errors in {@link HttpException}; leaves other values unchanged.
 *
 * @param error - Value from a `catch` clause.
 * @returns `error` when it is already an {@link HttpException}, a new {@link HttpException}
 * when `error` is a recognized transport failure, otherwise `error` unchanged.
 */
export function normalizeHttpException(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (error instanceof HttpException) {
    return error;
  }

  if (!isHttpException(error)) {
    return error;
  }

  const code = getHttpErrorCode(error);
  return new HttpException(
    code ? `HTTP error! cause: ${code}` : 'HTTP error!',
    { cause: error },
  );
}

/**
 * @param error - Value from a `catch` clause.
 * @returns Whether `error` is an invalid request/response shape error.
 */
export function isInvalidApiRequestOrResponseException(
  error: unknown,
): error is InvalidHttpRequestParamsException | InvalidHttpResponseException {
  return (
    error instanceof InvalidHttpRequestParamsException ||
    error instanceof InvalidHttpResponseException
  );
}

/**
 * Checks if the error is a {@link StellarSnapException} (including subclasses).
 *
 * @param error - Value from a `catch` clause.
 * @returns Whether `error` is a {@link StellarSnapException} (including subclasses).
 */
export function isStellarSnapException(
  error: unknown,
): error is StellarSnapException {
  return error instanceof StellarSnapException;
}

/**
 * A utility function that catches errors and throws them as SnapError.
 *
 * @param fn - The function to catch errors from.
 * @param logger - The logger to use for logging errors. Defaults to the default logger.
 * @returns The result of the function.
 */
export const withCatchAndThrowSnapError = async <ResponseT>(
  fn: () => Promise<ResponseT>,
  logger: ILogger = defaultLogger,
): Promise<ResponseT> => {
  try {
    return await fn();
  } catch (errorInstance: unknown) {
    await trackErrorIfNeeded(errorInstance);

    let error: SnapRpcError;

    if (errorInstance instanceof Error) {
      if (isStellarSnapException(errorInstance)) {
        error = new SnapError(errorInstance);
      } else if (isSnapRpcError(errorInstance)) {
        error = errorInstance;
      } else {
        error = new SnapError(errorInstance);
      }
    } else {
      error = new SnapError(errorInstance as string | Error);
    }

    logger.error(
      { error },
      `[SnapError] ${JSON.stringify(error.toJSON(), null, 2)}`,
    );

    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw error;
  }
};

/**
 * Sends `error` to Sentry when it represents an unexpected failure.
 *
 * Skips tracking for transient HTTP failures and explicit user rejections.
 * Callers should prefer this over {@link trackError} in swallow paths; entry
 * points use it via {@link withCatchAndThrowSnapError}. Sensitive-field scrubbing
 * is handled by MetaMask after `snap_trackError` receives the payload.
 *
 * @param error - Value from a `catch` clause.
 */
export async function trackErrorIfNeeded(error: unknown): Promise<void> {
  if (isHttpException(error)) {
    return;
  }

  if (error instanceof UserRejectedRequestError) {
    return;
  }

  await trackError(error);
}
