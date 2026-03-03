/* eslint-disable jest/expect-expect -- assertions are in assertValid/assertInvalid helpers */
import { assert } from '@metamask/superstruct';

import { UrlStruct } from './url';

const assertValid = (value: string) => {
  expect(() => assert(value, UrlStruct)).not.toThrow();
};

const assertInvalid = (value: string, expectedMessage?: string) => {
  try {
    assert(value, UrlStruct);
    throw new Error('Expected assertion to throw');
  } catch (thrown) {
    const error = thrown as Error;
    expect(error).toBeDefined();
    if (expectedMessage !== undefined) {
      expect(error.message).toContain(expectedMessage);
    }
  }
};

describe('UrlStruct', () => {
  it.each([
    // https URL with domain
    'https://example.com',
    // https URL with path
    'https://example.com/path/to/resource',
    // https URL with query string
    'https://example.com/api?foo=bar',
    // http URL
    'http://example.com',
    // wss URL
    'wss://example.com/socket',
    // localhost without port
    'http://localhost',
    // localhost with port
    'http://localhost:3000',
    // https URL with domain
    'https://api.example.com',
  ])('accepts %s', (url) => {
    assertValid(url);
  });

  describe('protocol validation', () => {
    it.each([
      // ftp protocol
      'ftp://example.com',
      // file protocol
      'file:///etc/passwd',
      // javascript protocol
      // eslint-disable-next-line no-script-url
      'javascript:alert(1)',
      // file protocol
      'file:///etc/passwd',
      // data URI
      'data:text/html,<script>',
      // ws protocol (non-wss)
      'ws://example.com',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'URL must use one of the following protocols');
    });
  });

  describe('malformed URL format', () => {
    it.each([
      // invalid URL format
      'http:not-a-url',
      // empty string
      'wss:example.com',
      // malformed protocol format
      'https:example.com',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'Malformed URL - incorrect protocol format');
    });
  });

  describe('hostname validation', () => {
    it.each([
      // invalid hostname without dot
      'https://invalid',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'Invalid hostname format');
    });
  });

  describe('protocol pollution', () => {
    it.each([
      // backslash in URL
      'https://example.com\\@evil.com',
      // @ in URL
      'https://evil.com@example.com',
      // %2f@ pattern
      'https://example.com%2f@evil.com',
      // %5c@ pattern
      'https://example.com%5c@evil.com',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'protocol pollution');
    });
  });

  describe('directory traversal', () => {
    it.each([
      'https://example.com/../etc/passwd',
      'https://example.com/..%2fetc/passwd',
      'https://example.com/..%2Fetc/passwd',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'Directory traversal');
    });
  });

  describe('dangerous patterns', () => {
    it.each([
      'https://example.com/<script>',
      'https://example.com/javascript:alert(1)',
      'https://example.com/data:text/html',
      'https://example.com/#{payload}',
      'https://example.com/page|id',
      'https://example.com/page;id',
    ])('rejects %s', (url) => {
      assertInvalid(url, 'malicious patterns');
    });
  });

  describe('port validation', () => {
    it.each(['https://example.com:abc'])('rejects %s', (url) => {
      assertInvalid(url, 'Invalid URL format');
    });
  });
});
