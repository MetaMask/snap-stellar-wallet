import type { Infer } from '@metamask/superstruct';
import { refine, string } from '@metamask/superstruct';

/**
 * Validation struct for a UTF-8 string.
 */
export const Utf8StringStruct = refine(string(), 'utf8', (value) => {
  try {
    // Attempt to encode to UTF-8
    const encoder = new TextEncoder();
    encoder.encode(value);
    return true; // Valid UTF-8
  } catch {
    return 'Invalid UTF-8 string';
  }
});

export type Utf8String = Infer<typeof Utf8StringStruct>;
