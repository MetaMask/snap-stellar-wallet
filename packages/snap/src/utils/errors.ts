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
 * @returns A sanitized error with a generic message if sensitive info is detected.
 */
export function sanitizeSensitiveError(error: Error): Error {
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
    (keyword) => message.includes(keyword) || stack.includes(keyword),
  );

  if (containsSensitiveInfo) {
    const maskedMessage =
      'Key derivation failed. Please check your connection and try again.';
    // Return generic error without exposing sensitive details
    const sanitizedError = new Error(maskedMessage);
    // Preserve error type if it's a Snap error
    if (isSnapRpcError(error)) {
      const Ctor = error.constructor;
      if (typeof Ctor === 'function') {
        try {
          return new (Ctor as new (message: unknown) => typeof error)(
            maskedMessage,
          );
        } catch {
          return sanitizedError;
        }
      }
      return sanitizedError;
    }
    return sanitizedError;
  }

  return error;
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
    let error: SnapRpcError;

    if (errorInstance instanceof Error) {
      error = isSnapRpcError(errorInstance)
        ? errorInstance
        : new SnapError(errorInstance);
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
