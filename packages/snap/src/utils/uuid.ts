/**
 * Generates a random UUID v4 via the Web Crypto API.
 *
 * Centralizes `globalThis.crypto.randomUUID()` so call sites stay free of the
 * Node-builtins lint that flags `crypto` under the test Node 22 settings.
 *
 * @returns A UUID v4 string.
 */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
