import { string } from '@metamask/superstruct';

import { assertOrThrow } from './assertOrThrow';

describe('assertOrThrow', () => {
  it('throws an error if the value does not pass the struct', () => {
    expect(() =>
      assertOrThrow(1, string(), new Error('Invalid value')),
    ).toThrow('Invalid value');
  });
});
