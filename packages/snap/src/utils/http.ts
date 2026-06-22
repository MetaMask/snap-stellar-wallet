import type { Struct } from '@metamask/superstruct';
import { assert, enums, object, type } from '@metamask/superstruct';

import {
  StellarSnapException,
  type StellarSnapExceptionOptions,
} from './errors';

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
