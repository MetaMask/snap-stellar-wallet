import type { Struct } from '@metamask/superstruct';
import { assert } from '@metamask/superstruct';

/**
 * Asserts that a value passes a struct and throws an error if it does not.
 *
 * @param value - The value to assert.
 * @param struct - The struct to assert.
 * @param errorToThrow - The error to throw.
 * @param errorToThrow.cause - The cause of the error to throw.
 * @throws The error if the value does not pass the struct.
 */
export function assertOrThrow<Type, Schema>(
  value: unknown,
  struct: Struct<Type, Schema>,
  errorToThrow: { cause?: unknown },
): asserts value is Type {
  try {
    assert(value, struct);
  } catch (error) {
    errorToThrow.cause = error;
    throw errorToThrow as Error;
  }
}
