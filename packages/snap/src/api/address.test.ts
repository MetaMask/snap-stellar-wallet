import { assert, StructError } from '@metamask/superstruct';

import { StellarAddressStruct } from './address';
import { generateMockStellarKeyringAccounts } from '../services/account/__mocks__/fixtures';

describe('StellarAddressStruct', () => {
  it('accepts a valid Stellar address', () => {
    const mockAccounts = generateMockStellarKeyringAccounts(
      1,
      'entropy-source-1',
    );
    const address = mockAccounts[0]?.address;
    expect(() => assert(address, StellarAddressStruct)).not.toThrow();
  });

  it('rejects an invalid Stellar address', () => {
    const address = 'invalid-address';
    expect(() => assert(address, StellarAddressStruct)).toThrow(StructError);
  });
});
