import { assert, StructError } from '@metamask/superstruct';

import { UuidStruct } from './uuid';

describe('UuidStruct', () => {
  it.each([
    'c747acb9-1b2b-4352-b9da-3d658fcc3cc7',
    '2507a426-ac26-43c4-a82a-250f5d999398',
    '52d181f4-d050-4971-b448-17c15107fa3b',
    '52d181f4-d050-4971-b448-17c15107fa3b'.toUpperCase(),
  ])('accepts valid UUID: %s', (uuid) => {
    expect(() => assert(uuid, UuidStruct)).not.toThrow();
  });

  it.each([
    'not-a-uuid',
    '12345678-1234-4234-8234-1234',
    '12345678-1234-4234-8234-1234567890123',
  ])('rejects invalid UUID: %s', (uuid) => {
    expect(() => assert(uuid, UuidStruct)).toThrow(StructError);
  });
});
