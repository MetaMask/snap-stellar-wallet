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

import type { ILogger } from './logger';
import { logger as defaultLogger } from './logger';

/**
 * Sanitizes error messages that may contain sensitive cryptographic information.
 * This prevents leaking details about private keys, entropy, or derivation paths.
 *
 * @param error - The error to sanitize.
 * @returns A sanitized error with generic message if sensitive info detected.
 */
// TODO: Replace `any` with type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeSensitiveError(error: any): Error {
  const message = error?.message?.toLowerCase() ?? '';
  const stack = error?.stack?.toLowerCase() ?? '';

  // Check for sensitive keywords in error message or stack trace
  const sensitiveKeywords = [
    'private',
    'key',
    'entropy',
    'mnemonic',
    'seed',
    'derivation',
    'bip32',
    'bip44',
    'secret',
  ];

  const containsSensitiveInfo = sensitiveKeywords.some(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    (keyword) => message.includes(keyword) || stack.includes(keyword),
  );

  if (containsSensitiveInfo) {
    const maskedMessage =
      'Key derivation failed. Please check your connection and try again.';
    // Return generic error without exposing sensitive details
    const sanitizedError = new Error(maskedMessage);
    // Preserve error type if it's a Snap error
    if (isSnapRpcError(error)) {
      // All snap errors should have a constructor that can be called with a message
      return error.constructor
        ? new error.constructor(maskedMessage)
        : sanitizedError;
    }
    return sanitizedError;
  }

  return error;
}

/**
 * Determines if the given error is a Snap RPC error.
 *
 * @param error - The error instance to be checked.
 * @returns A boolean indicating whether the error is a Snap RPC error.
 */
export function isSnapRpcError(error: Error): boolean {
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
    // TODO: Replace `any` with type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (errorInstance: any) {
    const error = isSnapRpcError(errorInstance)
      ? errorInstance
      : new SnapError(errorInstance);

    logger.error(
      { error },
      `[SnapError] ${JSON.stringify(error.toJSON(), null, 2)}`,
    );

    throw error;
  }
};
