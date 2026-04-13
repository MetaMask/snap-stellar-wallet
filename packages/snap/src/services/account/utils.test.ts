import { DerivedAccountAddressMismatchException } from './exceptions';
import { assertSameAddress } from './utils';

describe('assertSameAddress', () => {
  it('returns when strkeys match ignoring case', () => {
    const upper = 'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF';
    const lower = 'gdrz4b4x2gcm3iinpebuyqxto2gjx6ydtv5omlc7tktgl33wnekluskf';
    expect(() => assertSameAddress(upper, lower)).not.toThrow();
  });

  it('throws DerivedAccountAddressMismatchException when strkeys differ', () => {
    const expected = 'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF';
    const actual = 'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';
    expect(() => assertSameAddress(expected, actual)).toThrow(
      DerivedAccountAddressMismatchException,
    );
  });
});
