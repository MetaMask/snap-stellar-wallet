import {
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Keypair,
} from '@stellar/stellar-sdk';

import { buildMockClassicTransaction } from './__mocks__/transaction.fixtures';
import { OperationMapper } from './OperationMapper';
import { KnownCaip2ChainId } from '../../api';

describe('OperationMapper', () => {
  const mapper = new OperationMapper();

  it('maps payment and changeTrust with JSON-serializable output', () => {
    const dest = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const wrapped = buildMockClassicTransaction([
      {
        type: 'payment',
        params: {
          destination: dest,
          asset: 'native',
          amount: '10',
        },
      },
      {
        type: 'changeTrust',
        params: {
          asset: { code: 'USD', issuer },
          limit: '1000',
        },
      },
    ]);

    const json = mapper.mapTransaction(wrapped);
    const txSource = wrapped.sourceAccount;

    expect(json.scope).toBe(KnownCaip2ChainId.Testnet);
    // Builder `fee` is per operation; total is fee × operation count.
    expect(json.feeStroops).toBe('400');
    expect(json.operationCount).toBe(2);
    expect(() => JSON.stringify(json)).not.toThrow();

    expect(json.operations[0]).toMatchObject({
      index: 0,
      type: 'payment',
      source: txSource,
      explicitSource: null,
      classic: true,
      params: [
        { key: 'destination', value: dest, type: 'address' },
        {
          key: 'asset',
          type: 'assetWithAmount',
          value: ['native', '10.0000000'],
        },
      ],
    });

    expect(json.operations[1]).toMatchObject({
      index: 1,
      type: 'changeTrust',
      source: txSource,
      explicitSource: null,
      classic: true,
      params: [
        { key: 'line', value: `USD:${issuer}`, type: 'text' },
        { key: 'limit', value: '1000.0000000', type: 'amount' },
      ],
    });
  });

  it('sets source and explicitSource when operation overrides source account', () => {
    const txKp = Keypair.random();
    const opSourceKp = Keypair.random();
    const dest = Keypair.random().publicKey();
    const wrapped = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            source: opSourceKp.publicKey(),
            destination: dest,
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        source: { accountId: txKp.publicKey(), sequence: '1' },
        baseFeePerOperation: '100',
      },
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.source).toBe(opSourceKp.publicKey());
    expect(op?.explicitSource).toBe(opSourceKp.publicKey());
  });

  it('maps createAccount operation', () => {
    const dest = Keypair.random().publicKey();
    const wrapped = buildMockClassicTransaction([
      {
        type: 'createAccount',
        params: { destination: dest, startingBalance: '5' },
      },
    ]);

    const [op] = mapper.mapTransaction(wrapped).operations;
    expect(op).toBeDefined();
    expect(op?.source).toBe(wrapped.sourceAccount);
    expect(op?.explicitSource).toBeNull();
    expect(op?.params).toStrictEqual([
      { key: 'destination', value: dest, type: 'address' },
      { key: 'startingBalance', value: '5.0000000', type: 'amount' },
    ]);
  });

  it('maps setOptions setFlags and clearFlags to readable flag labels', () => {
    const wrapped = buildMockClassicTransaction([
      {
        type: 'setOptions',
        params: {
          // eslint-disable-next-line no-bitwise -- combine disjoint AuthFlag bits
          setFlags: AuthRequiredFlag | AuthClawbackEnabledFlag,
          clearFlags: AuthRevocableFlag,
        },
      },
    ]);

    const [op] = mapper.mapTransaction(wrapped).operations;
    expect(op?.type).toBe('setOptions');
    expect(op?.params).toStrictEqual([
      {
        key: 'clearFlags',
        value: ['authRevocable'],
        type: 'text',
      },
      {
        key: 'setFlags',
        value: ['authRequired', 'authClawbackEnabled'],
        type: 'text',
      },
    ]);
  });

  it('maps unknown setOptions flag bits to unknown(0x…) suffix', () => {
    const wrapped = buildMockClassicTransaction([
      {
        type: 'setOptions',
        params: { setFlags: 16 },
      },
    ]);

    const [op] = mapper.mapTransaction(wrapped).operations;
    expect(op?.params).toStrictEqual([
      { key: 'setFlags', value: ['unknown(0x10)'], type: 'text' },
    ]);
  });
});
