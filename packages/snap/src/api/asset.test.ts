import { assert, StructError } from '@metamask/superstruct';

import {
  FiatCaipAssetStruct,
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
} from './asset';

describe('KnownCaip19ClassicAssetStruct', () => {
  it('accepts a valid CAIP-19 asset', () => {
    expect(() =>
      assert(
        'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        KnownCaip19ClassicAssetStruct,
      ),
    ).not.toThrow();
  });

  it('rejects an invalid CAIP-19 asset', () => {
    const address = 'invalid-caip19-asset';
    expect(() => assert(address, KnownCaip19ClassicAssetStruct)).toThrow(
      StructError,
    );
  });
});

describe('KnownCaip19Sep41AssetStruct', () => {
  it.each([
    'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J',
    'stellar:pubnet/sep41:CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN',
  ])('accepts a valid CAIP-19 asset', (assetId) => {
    expect(() => assert(assetId, KnownCaip19Sep41AssetStruct)).not.toThrow();
  });

  it('rejects an invalid CAIP-19 asset', () => {
    const address = 'invalid-caip19-asset';
    expect(() => assert(address, KnownCaip19Sep41AssetStruct)).toThrow(
      StructError,
    );
  });
});

describe('FiatCaipAssetStruct', () => {
  it.each(['swift:0/iso4217:USD', 'swift:0/iso4217:eur'])(
    'accepts a valid fiat CAIP-19 asset id',
    (assetId) => {
      expect(() => assert(assetId, FiatCaipAssetStruct)).not.toThrow();
    },
  );

  it.each([
    'stellar:pubnet/slip44:148',
    'eip155:1/swift:0/iso4217:USD',
    'swift:0/iso4217:US',
    'swift:0/iso4217:USDC',
    'eip155:1/notswift:0/iso4217:USD',
  ])('rejects a non-fiat CAIP-19 asset id', (assetId) => {
    expect(() => assert(assetId, FiatCaipAssetStruct)).toThrow(StructError);
  });
});

describe('KnownCaip19Slip44IdStruct', () => {
  it('accepts a valid CAIP-19 asset', () => {
    expect(() =>
      assert('stellar:pubnet/slip44:148', KnownCaip19Slip44IdStruct),
    ).not.toThrow();
  });

  it('rejects an invalid CAIP-19 asset', () => {
    const address = 'invalid-caip19-asset';
    expect(() => assert(address, KnownCaip19Slip44IdStruct)).toThrow(
      StructError,
    );
  });
});
