import { assert, StructError } from '@metamask/superstruct';

import { CreateAccountOptionsStruct } from './api';

describe('CreateAccountOptionsStruct', () => {
  it.each([
    {},
    undefined,
    { index: 0 },
    { index: 1 },
    { entropySource: 'ulid-123', index: 0 },
  ])('accepts valid options', (options) => {
    expect(() => assert(options, CreateAccountOptionsStruct)).not.toThrow();
  });

  it.each([{ index: -1 }, { entropySource: 1, index: 0 }])(
    'rejects invalid options',
    (options) => {
      expect(() => assert(options, CreateAccountOptionsStruct)).toThrow(
        StructError,
      );
    },
  );
});
