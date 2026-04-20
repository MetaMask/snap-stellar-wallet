import { assert, StructError } from '@metamask/superstruct';

import { OnAssetsLookupRequestStruct } from './api';
import {
  NATIVE,
  USDC_CLASSIC,
  USDC_SEP41,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';

describe('OnAssetsLookupRequestStruct', () => {
  it.each([
    { assets: [USDC_CLASSIC] },
    { assets: [USDC_SEP41] },
    { assets: [NATIVE] },
    { assets: [USDC_CLASSIC, USDC_SEP41, NATIVE] },
  ])('accepts valid assets request', (request) => {
    expect(() => assert(request, OnAssetsLookupRequestStruct)).not.toThrow();
  });

  it.each([
    { assets: ['invalid-asset-id'] },
    { assets: ['eip155:1/erc20:0x0000000000000000000000000000000000000000'] },
    { assets: 'stellar:pubnet/slip44:148' },
    {},
  ])('rejects invalid assets request', (assetId) => {
    expect(() => assert(assetId, OnAssetsLookupRequestStruct)).toThrow(
      StructError,
    );
  });
});
