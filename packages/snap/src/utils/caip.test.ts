import { AssetType, KnownCaip19Slip44IdMap, KnownCaip2ChainId } from '../api';
import {
  getAssetReference,
  getSlip44AssetId,
  isClassicAssetId,
  isSep41Id,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  toCaipAssetReference,
} from './caip';

const CLASSIC_ASSET_ID =
  'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const SEP41_ASSET_ID =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J';

const SLIP44_ASSET_ID = 'stellar:pubnet/slip44:148';

describe('toCaip19ClassicAssetId', () => {
  it('builds a CAIP-19 classic asset id from scope, code, and issuer', () => {
    expect(
      toCaip19ClassicAssetId(
        KnownCaip2ChainId.Mainnet,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
    ).toBe(CLASSIC_ASSET_ID);
  });
});

describe('toCaip19Sep41AssetId', () => {
  it('builds a CAIP-19 sep41 asset id from scope and contract address', () => {
    expect(
      toCaip19Sep41AssetId(
        KnownCaip2ChainId.Mainnet,
        'CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J',
      ),
    ).toBe(SEP41_ASSET_ID);
  });
});

describe('isSlip44Id', () => {
  it('returns true for known slip44 ids from the map', () => {
    expect(isSlip44Id(KnownCaip19Slip44IdMap[KnownCaip2ChainId.Mainnet])).toBe(
      true,
    );
    expect(isSlip44Id(KnownCaip19Slip44IdMap[KnownCaip2ChainId.Testnet])).toBe(
      true,
    );
  });

  it('returns false for non-slip44 asset ids', () => {
    expect(isSlip44Id(CLASSIC_ASSET_ID)).toBe(false);
    expect(isSlip44Id(SEP41_ASSET_ID)).toBe(false);
    expect(isSlip44Id('unknown')).toBe(false);
  });
});

describe('isSep41Id', () => {
  it('returns true for a valid sep41 CAIP-19 id', () => {
    expect(isSep41Id(SEP41_ASSET_ID)).toBe(true);
  });

  it('returns false for classic and slip44 ids', () => {
    expect(isSep41Id(CLASSIC_ASSET_ID)).toBe(false);
    expect(isSep41Id(SLIP44_ASSET_ID)).toBe(false);
  });
});

describe('isClassicAssetId', () => {
  it('returns true for a valid classic CAIP-19 id', () => {
    expect(isClassicAssetId(CLASSIC_ASSET_ID)).toBe(true);
  });

  it('returns false for sep41 and slip44 ids', () => {
    expect(isClassicAssetId(SEP41_ASSET_ID)).toBe(false);
    expect(isClassicAssetId(SLIP44_ASSET_ID)).toBe(false);
  });
});

describe('getAssetReference', () => {
  it('returns the asset reference segment of a CAIP-19 id', () => {
    expect(getAssetReference(CLASSIC_ASSET_ID)).toBe(
      'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    expect(getAssetReference(SEP41_ASSET_ID)).toBe(
      'CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J',
    );
    expect(getAssetReference(SLIP44_ASSET_ID)).toBe('148');
  });
});

describe('getSlip44AssetId', () => {
  it('returns the slip44 id for the given chain scope', () => {
    expect(getSlip44AssetId(KnownCaip2ChainId.Mainnet)).toBe(
      `${KnownCaip2ChainId.Mainnet}/${AssetType.Native}:148`,
    );
    expect(getSlip44AssetId(KnownCaip2ChainId.Testnet)).toBe(
      `${KnownCaip2ChainId.Testnet}/${AssetType.Native}:148`,
    );
  });
});

describe('toCaipAssetReference', () => {
  it('returns the input unchanged when it has no colon', () => {
    expect(toCaipAssetReference('USDC-GA5Z')).toBe('USDC-GA5Z');
  });

  it('joins code and issuer with a hyphen when given colon form', () => {
    expect(toCaipAssetReference('USDC:GA5Z')).toBe('USDC-GA5Z');
  });

  it('throws when colon form is missing code or issuer', () => {
    expect(() => toCaipAssetReference(':onlyIssuer')).toThrow(
      'Invalid asset reference: :onlyIssuer',
    );
    expect(() => toCaipAssetReference('onlyCode:')).toThrow(
      'Invalid asset reference: onlyCode:',
    );
  });
});

describe('parseClassicAssetCodeIssuer', () => {
  it('parses hyphen-separated classic reference', () => {
    expect(
      parseClassicAssetCodeIssuer(
        'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
    ).toStrictEqual({
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
  });

  it('parses colon-separated classic reference', () => {
    expect(
      parseClassicAssetCodeIssuer(
        'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
    ).toStrictEqual({
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
  });

  it('throws when reference is missing code or issuer', () => {
    expect(() => parseClassicAssetCodeIssuer('USDC-')).toThrow(
      'Invalid asset reference: USDC-',
    );
    expect(() => parseClassicAssetCodeIssuer(':G123')).toThrow(
      'Invalid asset reference: :G123',
    );
  });
});
