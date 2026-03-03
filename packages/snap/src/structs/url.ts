import { refine, string } from '@metamask/superstruct';

/**
 * Validates that a string is a valid and safe URL.
 *
 * It rejects:
 * - Non-HTTP/HTTPS/WSS protocols
 * - Malformed URL format or incorrect protocol format
 * - Invalid hostname format (must follow proper domain naming conventions)
 * - Protocol pollution attempts (backslashes, @ symbol, %2f@, %5c@)
 * - Invalid hostname characters (backslashes, @ symbol, forward slashes, encoded forward slashes)
 * - Directory traversal attempts (../, ..%2f, ..%2F)
 *
 * Dangerous patterns including:
 * - HTML tags.
 * - JavaScript protocol.
 * - Data URI scheme.
 * - Template injection (${...}, #{...}).
 * - Command injection (|, ;).
 * - CRLF injection.
 * - URL credential injection.
 * - SQL injection attempts.
 * - Open redirect parameters.
 * - Non-printable characters.
 */
export const UrlStruct = refine(string(), 'safe-url', (value) => {
  try {
    // Basic URL validation
    const url = new URL(value);

    // Protocol check
    const supportedProtocols = ['http:', 'https:', 'wss:'];
    if (!supportedProtocols.includes(url.protocol)) {
      return `URL must use one of the following protocols: ${supportedProtocols.join(', ')}`;
    }

    // Validate URL format
    if (!value.match(/^(https?|wss):\/\/[^/]+\/?/u)) {
      return 'Malformed URL - incorrect protocol format';
    }

    // Validate hostname format. Accepts localhost and ports (needed for tests)
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== 'localhost' &&
      (!hostname.includes('.') ||
        !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/u.test(
          hostname,
        ))
    ) {
      return 'Invalid hostname format';
    }

    // Check for protocol pollution in the entire URL
    const decodedValue = decodeURIComponent(value.toLowerCase());
    if (
      value.includes('\\') ||
      value.includes('@') ||
      decodedValue.includes('\\') ||
      decodedValue.includes('@') ||
      value.toLowerCase().includes('%2f@') ||
      value.toLowerCase().includes('%5c@')
    ) {
      return 'URL contains protocol pollution attempts';
    }

    // Additional hostname safety check for protocol pollution
    const decodedHostname = decodeURIComponent(hostname);
    if (
      hostname.includes('\\') ||
      hostname.includes('@') ||
      decodedHostname.includes('/') ||
      hostname.toLowerCase().includes('%2f')
    ) {
      return 'Invalid hostname characters detected';
    }

    // Check for directory traversal
    if (
      value.includes('../') ||
      value.includes('..%2f') ||
      value.includes('..%2F')
    ) {
      return 'Directory traversal attempts are not allowed';
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /<[^>]*>/u, // HTML tags
      /javascript:/u, // JavaScript protocol
      /data:/u, // Data URI scheme
      /\\[@\\]/u, // Enhanced protocol pollution check
      /%2f@/u, // Protocol pollution
      /[^\x20-\x7E]/u, // Non-printable characters
      /\$\{.*?\}/u, // Template injection
      /#\{.*?\}/u, // Template injection
      /[|;]/u, // Command injection
      /%0[acd]|%0[acd]/u, // CRLF injection
      /\/\/\w+@/u, // URL credential injection
      // Enhanced SQL injection patterns
      /(?:[^a-z]|^)(?:union\s+(?:all\s+)?select|select\s+(?:.*\s+)?from|insert\s+into|update\s+.*\s+set|delete\s+from|drop\s+table|alter\s+table|create\s+table|exec(?:ute)?|union|where\s+[\d\w]\s*=\s*[\d\w]|\bor\b\s*[\d\w]\s*=\s*[\d\w])/iu,
      /'.*?(?:OR|UNION|SELECT|FROM|WHERE).*?'/iu, // SQL injection
      /%27.*?(?:OR|UNION|SELECT|FROM|WHERE).*?(?:%27|')/iu, // URL-encoded SQL injection
      /%20(?:OR|UNION|SELECT|FROM|WHERE)%20/iu, // URL-encoded SQL keywords
      /[?&](?:url|redirect|next|return_to|return_url|goto|destination|continue|redirect_uri)=(?:[^&]*\/\/|https?:)/iu, // Open redirect parameters
      /[?&](?:url|redirect|next|return_to|return_url|goto|destination|continue|redirect_uri)=%(?:[^&]*\/\/|https?:)/iu, // URL-encoded open redirect parameters
    ];

    for (const patt of dangerousPatterns) {
      if (patt.test(decodedValue)) {
        return 'URL contains potentially malicious patterns';
      }
    }

    // Port validation (if present)
    if (url.port && !/^\d+$/u.test(url.port)) {
      return 'Invalid port number';
    }

    return true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return 'Invalid URL format';
  }
});
