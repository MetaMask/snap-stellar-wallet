/**
 * Removes control characters from a string.
 * Control characters can be used for injection attacks and should be stripped from user input.
 *
 * @param input - The string to sanitize.
 * @returns The sanitized string with control characters removed.
 */
export function sanitizeControlCharacters(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove all control characters except tab
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000A-\u001F\u007F]/gu, '');
}

/**
 * Validates and sanitizes a URI.
 *
 * @param uri - The URI to validate and sanitize.
 * @returns The sanitized URI or empty string if invalid.
 */
export function sanitizeUri(uri: string): string {
  if (!uri || typeof uri !== 'string') {
    return '';
  }

  const sanitized = sanitizeControlCharacters(uri);

  try {
    const url = new URL(sanitized);
    const allowedProtocols = ['http:', 'https:', 'wss:'];
    if (!allowedProtocols.includes(url.protocol)) {
      return '';
    }
    if (sanitized.length > 2048) {
      return '';
    }
    return sanitized;
  } catch {
    return '';
  }
}
