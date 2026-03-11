import { assert, StructError } from '@metamask/superstruct';
import { StellarAddressStruct } from './address';

describe('StellarAddressStruct', () => {
  it('accepts a valid Stellar address', () => {
    expect(() =>
      assert(
        'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO',
        StellarAddressStruct,
      ),
    ).not.toThrow();
  });

  it('rejects an invalid Stellar address', () => {
    const address = 'invalid-address';
    expect(() => assert(address, StellarAddressStruct)).toThrow(StructError);
  });
});
