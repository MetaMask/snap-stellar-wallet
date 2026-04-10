import { assert } from '@metamask/superstruct';

import { sanitizeControlCharacters, sanitizeUri } from './sanitize';
import { UrlStruct } from '../api';

export type BuildUrlParams = {
  baseUrl: string;
  path: string;
  pathParams?: Record<string, string> | undefined;
  queryParams?: Record<string, string> | undefined;
  encodePathParams?: boolean;
};

/**
 * Builds a URL with the given base URL and parameters:
 * - The `URL` API provides proper URL parsing and encoding.
 * - The `path` is sanitized to prevent path traversal attacks.
 * - Path and query parameters are sanitized to remove control characters.
 *
 * Ensures that the built URL is safe, valid, and sanitized.
 *
 * @param params - The parameters to build the URL from.
 * @returns The built URL.
 */
export function buildUrl(params: BuildUrlParams): string {
  const {
    baseUrl,
    path,
    pathParams,
    queryParams,
    encodePathParams = true,
  } = params;

  // Validate and sanitize base URL
  const sanitizedBaseUrl = sanitizeUri(baseUrl);
  if (sanitizedBaseUrl === '') {
    throw new Error('Invalid URL format');
  }
  assert(sanitizedBaseUrl, UrlStruct);

  const pathWithParams = path.replace(/\{(\w+)\}/gu, (_match, key: string) => {
    const value = pathParams?.[key];
    if (value === undefined) {
      throw new Error(`Path parameter ${key} is undefined`);
    }
    // Sanitize path parameter values to remove control characters
    const sanitizedValue = sanitizeControlCharacters(value);
    return encodePathParams
      ? encodeURIComponent(sanitizedValue)
      : sanitizedValue;
  });

  const cleanPath = pathWithParams
    .replace(/^\/+/u, '') // Remove leading slashes
    .replace(/\/+/gu, '/') // Replace multiple slashes with single
    .replace(/\/+$/u, ''); // Remove trailing slashes

  // Ensure base URL has trailing slash for proper path appending
  const normalizedBaseUrl = sanitizedBaseUrl.endsWith('/')
    ? sanitizedBaseUrl
    : `${sanitizedBaseUrl}/`;

  const url = new URL(cleanPath, normalizedBaseUrl);
  Object.entries(queryParams ?? {})
    .filter(([_key, value]) => value !== undefined)
    .filter(([_key, value]) => value !== null)
    .forEach(([key, value]) => {
      if (value) {
        // Sanitize query parameter values to remove control characters
        const sanitizedValue = sanitizeControlCharacters(value);
        url.searchParams.append(key, sanitizedValue);
      }
    });

  const builtUrl = url.toString();
  assert(builtUrl, UrlStruct);
  return builtUrl;
}
