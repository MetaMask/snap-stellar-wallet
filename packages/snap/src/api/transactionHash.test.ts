import { assert, StructError } from '@metamask/superstruct';

import { StellarTransactionHashStruct } from './transactionHash';

describe('StellarTransactionHashStruct', () => {
  it.each([
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1',
    '7D4B0C5EF7498B223F45A10F461060FB64F53EB13CAF18E8DC7DE95A8CF9C0E1',
  ])('accepts a valid Stellar transaction hash: %s', (transactionHash) => {
    expect(() =>
      assert(transactionHash, StellarTransactionHashStruct),
    ).not.toThrow();
  });

  it.each([
    '',
    'dGVzdA==',
    'not-a-transaction-hash',
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0',
    '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0eg',
  ])('rejects an invalid Stellar transaction hash: %s', (transactionHash) => {
    expect(() => assert(transactionHash, StellarTransactionHashStruct)).toThrow(
      StructError,
    );
  });
});
