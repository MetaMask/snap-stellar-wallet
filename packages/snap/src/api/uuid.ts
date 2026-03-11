import type { Infer } from '@metamask/superstruct';
import { definePattern } from '@metamask/utils';

/**
 * Validation struct for UUID: must be a string matching the UUID v4 format.
 */
export const UuidStruct = definePattern(
  'UuidV4',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
);

export type UUID = Infer<typeof UuidStruct>;
