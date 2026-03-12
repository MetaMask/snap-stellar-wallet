/* eslint-disable @typescript-eslint/only-throw-error */
import {
  InvalidParamsError,
  SnapError,
  UnauthorizedError,
} from '@metamask/snaps-sdk';
import type { Struct } from '@metamask/superstruct';
import { assert } from '@metamask/superstruct';

import { originPermissions } from '../permissions';

/**
 * Validates that the origin is allowed to make the request.
 * If the origin is not found or the method is not allowed, an UnauthorizedError is thrown.
 *
 * @param origin - The origin of the request.
 * @param method - The method of the request.
 * @throws {UnauthorizedError} If the origin is not found or the method is not allowed.
 */
export const validateOrigin = (origin: string, method: string): void => {
  if (!origin) {
    throw new UnauthorizedError('Origin not found');
  }
  if (!originPermissions.get(origin)?.has(method)) {
    throw new UnauthorizedError('Permission denied');
  }
};

/**
 * Validates that the request parameters conform to the expected structure defined by the provided struct.
 *
 * @param requestParams - The request parameters to validate (typically unknown at call site).
 * @param struct - The expected structure of the request parameters.
 * @throws {InvalidParamsError} If the request parameters do not conform to the expected structure.
 */
export function validateRequest<Type, Schema>(
  requestParams: unknown,
  struct: Struct<Type, Schema>,
): asserts requestParams is Type {
  try {
    assert(requestParams, struct);
  } catch (validationError: unknown) {
    if (validationError instanceof Error) {
      throw new InvalidParamsError(validationError.message);
    }
    throw new InvalidParamsError('Invalid request parameters');
  }
}

/**
 * Validates that the response conforms to the expected structure defined by the provided struct.
 *
 * @param response - The response to validate (typically unknown at call site).
 * @param struct - The expected structure of the response.
 * @throws {SnapError} If the response does not conform to the expected structure.
 */
export function validateResponse<Type, Schema>(
  response: unknown,
  struct: Struct<Type, Schema>,
): asserts response is Type {
  try {
    assert(response, struct);
  } catch {
    // Mask the error message for security reasons.
    throw new SnapError('Invalid Response');
  }
}
/* eslint-enable @typescript-eslint/only-throw-error */
