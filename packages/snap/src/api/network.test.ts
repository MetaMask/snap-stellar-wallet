import { assert, StructError } from '@metamask/superstruct';

import { KnownCaip2ChainId, KnownCaip2ChainIdStruct } from './network';

describe('KnownCaip2ChainIdStruct', () => {
  it.each([KnownCaip2ChainId.Mainnet, KnownCaip2ChainId.Testnet])(
    'accepts valid chain ID',
    (chainId) => {
      expect(() => assert(chainId, KnownCaip2ChainIdStruct)).not.toThrow();
    },
  );

  it('rejects an invalid chain ID', () => {
    const chainId = 'invalid-chain-id';
    expect(() => assert(chainId, KnownCaip2ChainIdStruct)).toThrow(StructError);
  });
});
