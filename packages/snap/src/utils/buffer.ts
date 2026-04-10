/* eslint-disable no-restricted-globals */
/**
 * Converts a string or Uint8Array to a Buffer.
 *
 * @param val - The value to convert to a Uint8Array.
 * @param encode - The encoding to use.
 * @returns A Buffer.
 */
export function bufferToUint8Array(
  val: string | Uint8Array,
  encode?: 'hex' | 'base64' | 'utf8',
): Buffer {
  try {
    if (val instanceof Uint8Array) {
      return Buffer.from(val);
    }
    return Buffer.from(val, encode);
  } catch {
    // Hide the error for security reasons
    throw new Error('Invalid buffer');
  }
}
/* eslint-enable no-restricted-globals */
