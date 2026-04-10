import { string } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';

/**
 * Checks if a string is a valid base64 encoded string.
 *
 * @param message - The string to check.
 * @returns True if the string is a valid base64 encoded string, false otherwise.
 */
export function isBase64(message: string): boolean {
  const [error] = base64(string()).validate(message);
  return error === undefined;
}
