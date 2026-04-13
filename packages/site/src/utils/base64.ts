/**
 * Encode a UTF-8 string as standard base64 (for snap `signMessage` params).
 *
 * @param value - Plain text to encode.
 * @returns Base64 encoding of the UTF-8 bytes of `value`.
 */
export function utf8StringToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
