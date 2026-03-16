import { assert, StructError } from '@metamask/superstruct';

import { KnownCaip19AssetStruct } from './asset';

describe('KnownCaip19AssetStruct', () => {
  it('accepts a valid CAIP-19 asset', () => {
    expect(() =>
      assert(
        'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        KnownCaip19AssetStruct,
      ),
    ).not.toThrow();
  });

  it('rejects an invalid CAIP-19 asset', () => {
    const address = 'invalid-caip19-asset';
    expect(() => assert(address, KnownCaip19AssetStruct)).toThrow(StructError);
  });
});
