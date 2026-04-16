import {
  Account,
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Claimant,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder as StellarTransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import {
  buildMockClassicTransaction,
  buildMockInvokeHostFunctionTransaction,
} from './__mocks__/transaction.fixtures';
import { OperationMapper } from './OperationMapper';
import { Transaction } from './Transaction';
import { KnownCaip2ChainId } from '../../api';

/**
 * Builds a Transaction wrapper from raw SDK operations for types the fixture builder doesn't cover.
 *
 * @param ops - SDK operations to include in the transaction.
 * @returns A wrapped Transaction ready for mapper tests.
 */
function buildRawOpTransaction(...ops: any[]): Transaction {
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), '1');
  const builder = new StellarTransactionBuilder(account, {
    fee: '200',
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of ops) {
    builder.addOperation(op);
  }
  return new Transaction(builder.setTimeout(60).build());
}

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

  it('maps setOptions with ed25519PublicKey signer to address row', () => {
    const signerKey = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.setOptions({
        signer: { ed25519PublicKey: signerKey, weight: 1 },
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.params).toStrictEqual([
      { key: 'signerEd25519', value: signerKey, type: 'address' },
      { key: 'signerWeight', value: 1, type: 'number' },
    ]);
  });

  it('maps setOptions with sha256Hash signer to hex text row', () => {
    // eslint-disable-next-line no-restricted-globals -- SDK requires Buffer for sha256Hash
    const hashBuf = Buffer.alloc(32, 0xab);
    const wrapped = buildRawOpTransaction(
      Operation.setOptions({
        signer: { sha256Hash: hashBuf, weight: 2 },
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.params).toStrictEqual([
      { key: 'signerSha256Hash', value: hashBuf.toString('hex'), type: 'text' },
      { key: 'signerWeight', value: 2, type: 'number' },
    ]);
  });

  it('maps accountMerge operation', () => {
    const dest = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.accountMerge({ destination: dest }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('accountMerge');
    expect(op?.params).toStrictEqual([
      { key: 'destination', value: dest, type: 'address' },
    ]);
  });

  it('maps pathPaymentStrictReceive operation', () => {
    const dest = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const sendAsset = Asset.native();
    const destAsset = new Asset('USD', issuer);

    const wrapped = buildRawOpTransaction(
      Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax: '50',
        destination: dest,
        destAsset,
        destAmount: '100',
        path: [new Asset('EUR', issuer)],
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('pathPaymentStrictReceive');
    expect(op?.params).toStrictEqual([
      {
        key: 'sendAsset',
        value: ['native', '50.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'destination', value: dest, type: 'address' },
      {
        key: 'destAsset',
        value: [`USD:${issuer}`, '100.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'path', value: [`EUR:${issuer}`], type: 'json' },
    ]);
  });

  it('maps pathPaymentStrictSend operation', () => {
    const dest = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();

    const wrapped = buildRawOpTransaction(
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount: '25',
        destination: dest,
        destAsset: new Asset('EUR', issuer),
        destMin: '20',
        path: [],
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('pathPaymentStrictSend');
    expect(op?.params).toStrictEqual([
      {
        key: 'sendAsset',
        value: ['native', '25.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'destination', value: dest, type: 'address' },
      {
        key: 'destAsset',
        value: [`EUR:${issuer}`, '20.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'path', value: [], type: 'json' },
    ]);
  });

  it('maps manageSellOffer operation', () => {
    const issuer = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.manageSellOffer({
        selling: Asset.native(),
        buying: new Asset('USD', issuer),
        amount: '10',
        price: '2.5',
        offerId: '0',
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('manageSellOffer');
    expect(op?.params).toStrictEqual([
      {
        key: 'selling',
        value: ['native', '10.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'buying', value: `USD:${issuer}`, type: 'asset' },
      { key: 'price', value: '2.5', type: 'price' },
      { key: 'offerId', value: '0', type: 'text' },
    ]);
  });

  it('maps manageBuyOffer operation', () => {
    const issuer = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.manageBuyOffer({
        buying: new Asset('BTC', issuer),
        selling: Asset.native(),
        buyAmount: '5',
        price: '30000',
        offerId: '0',
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('manageBuyOffer');
    expect(op?.params).toStrictEqual([
      {
        key: 'buying',
        value: [`BTC:${issuer}`, '5.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'selling', value: 'native', type: 'asset' },
      { key: 'price', value: '30000', type: 'price' },
      { key: 'offerId', value: '0', type: 'text' },
    ]);
  });

  it('maps createPassiveSellOffer operation', () => {
    const issuer = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.createPassiveSellOffer({
        selling: Asset.native(),
        buying: new Asset('EUR', issuer),
        amount: '100',
        price: '1.1',
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('createPassiveSellOffer');
    expect(op?.params).toStrictEqual([
      {
        key: 'selling',
        value: ['native', '100.0000000'],
        type: 'assetWithAmount',
      },
      { key: 'buying', value: `EUR:${issuer}`, type: 'asset' },
      { key: 'price', value: '1.1', type: 'price' },
    ]);
  });

  it('maps manageData operation', () => {
    const wrapped = buildRawOpTransaction(
      Operation.manageData({ name: 'testKey', value: 'testValue' }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('manageData');
    expect(op?.params[0]).toStrictEqual({
      key: 'name',
      value: 'testKey',
      type: 'text',
    });
    expect(op?.params[1]?.key).toBe('valueBase64');
    expect(op?.params[1]?.type).toBe('text');
    expect(op?.params[1]?.value).toBeDefined();
  });

  it('maps manageData with null value (delete entry)', () => {
    const wrapped = buildRawOpTransaction(
      Operation.manageData({ name: 'deleteMe', value: null }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.params).toStrictEqual([
      { key: 'name', value: 'deleteMe', type: 'text' },
      { key: 'valueBase64', value: null, type: 'text' },
    ]);
  });

  it('maps bumpSequence operation', () => {
    const wrapped = buildRawOpTransaction(
      Operation.bumpSequence({ bumpTo: '999' }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('bumpSequence');
    expect(op?.params).toStrictEqual([
      { key: 'bumpTo', value: '999', type: 'text' },
    ]);
  });

  it('maps inflation operation with empty params', () => {
    const wrapped = buildRawOpTransaction(Operation.inflation({}));
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('inflation');
    expect(op?.params).toStrictEqual([]);
  });

  it('maps createClaimableBalance with unconditional predicate', () => {
    const dest = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.createClaimableBalance({
        asset: Asset.native(),
        amount: '50',
        claimants: [
          new Claimant(dest, xdr.ClaimPredicate.claimPredicateUnconditional()),
        ],
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('createClaimableBalance');
    expect(op?.params[0]).toStrictEqual({
      key: 'asset',
      value: 'native',
      type: 'asset',
    });
    expect(op?.params[1]).toStrictEqual({
      key: 'amount',
      value: '50.0000000',
      type: 'amount',
    });
    expect(op?.params[2]?.key).toBe('claimants');
    expect(op?.params[2]?.type).toBe('json');
    const claimants = op?.params[2]?.value as {
      destination: string;
      predicate: string;
    }[];
    expect(claimants).toHaveLength(1);
    expect(claimants[0]?.destination).toBe(dest);
    expect(claimants[0]?.predicate).toBe('unconditional');
  });

  it('maps claimClaimableBalance operation', () => {
    const balanceId =
      '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be';
    const wrapped = buildRawOpTransaction(
      Operation.claimClaimableBalance({ balanceId }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('claimClaimableBalance');
    expect(op?.params).toStrictEqual([
      { key: 'balanceId', value: balanceId, type: 'text' },
    ]);
  });

  it('maps beginSponsoringFutureReserves operation', () => {
    const sponsoredId = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.beginSponsoringFutureReserves({ sponsoredId }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('beginSponsoringFutureReserves');
    expect(op?.params).toStrictEqual([
      { key: 'sponsoredId', value: sponsoredId, type: 'address' },
    ]);
  });

  it('maps endSponsoringFutureReserves with empty params', () => {
    const wrapped = buildRawOpTransaction(
      Operation.endSponsoringFutureReserves({}),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('endSponsoringFutureReserves');
    expect(op?.params).toStrictEqual([]);
  });

  it('maps clawback operation', () => {
    const issuer = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.clawback({
        asset: new Asset('USD', issuer),
        amount: '100',
        from,
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('clawback');
    expect(op?.params).toStrictEqual([
      { key: 'asset', value: `USD:${issuer}`, type: 'asset' },
      { key: 'amount', value: '100.0000000', type: 'amount' },
      { key: 'from', value: from, type: 'address' },
    ]);
  });

  it('maps setTrustLineFlags with set and clear labels', () => {
    const trustor = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const wrapped = buildRawOpTransaction(
      Operation.setTrustLineFlags({
        trustor,
        asset: new Asset('USD', issuer),
        flags: {
          authorized: true,
          authorizedToMaintainLiabilities: false,
          clawbackEnabled: true,
        },
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('setTrustLineFlags');
    expect(op?.params).toStrictEqual([
      { key: 'trustor', value: trustor, type: 'address' },
      { key: 'asset', value: `USD:${issuer}`, type: 'asset' },
      {
        key: 'setFlags',
        value: ['authorized', 'clawbackEnabled'],
        type: 'text',
      },
      {
        key: 'clearFlags',
        value: ['authorizedToMaintainLiabilities'],
        type: 'text',
      },
    ]);
  });

  it('maps liquidityPoolDeposit operation', () => {
    const poolId =
      'dd7b1ab831c273310ddbec6f97870aa83c2a7c2f9c0f5978c2e2f0738d5066e8';
    const wrapped = buildRawOpTransaction(
      Operation.liquidityPoolDeposit({
        liquidityPoolId: poolId,
        maxAmountA: '100',
        maxAmountB: '200',
        minPrice: '0.5',
        maxPrice: '2.0',
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('liquidityPoolDeposit');
    expect(op?.params).toStrictEqual([
      { key: 'liquidityPoolId', value: poolId, type: 'text' },
      { key: 'maxAmountA', value: '100.0000000', type: 'amount' },
      { key: 'maxAmountB', value: '200.0000000', type: 'amount' },
      { key: 'minPrice', value: '0.5', type: 'price' },
      { key: 'maxPrice', value: '2', type: 'price' },
    ]);
  });

  it('maps liquidityPoolWithdraw operation', () => {
    const poolId =
      'dd7b1ab831c273310ddbec6f97870aa83c2a7c2f9c0f5978c2e2f0738d5066e8';
    const wrapped = buildRawOpTransaction(
      Operation.liquidityPoolWithdraw({
        liquidityPoolId: poolId,
        amount: '50',
        minAmountA: '20',
        minAmountB: '25',
      }),
    );
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('liquidityPoolWithdraw');
    expect(op?.params).toStrictEqual([
      { key: 'liquidityPoolId', value: poolId, type: 'text' },
      { key: 'amount', value: '50.0000000', type: 'amount' },
      { key: 'minAmountA', value: '20.0000000', type: 'amount' },
      { key: 'minAmountB', value: '25.0000000', type: 'amount' },
    ]);
  });

  it('maps invokeHostFunction with contractId, functionName, and arguments', () => {
    const wrapped = buildMockInvokeHostFunctionTransaction('transfer', [
      42,
      'hello',
    ]);
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('invokeHostFunction');
    expect(op?.classic).toBe(false);
    const keys = op?.params.map((param) => param.key);
    expect(keys).toContain('contractId');
    expect(keys).toContain('functionName');
    expect(keys).toContain('arguments');
    expect(keys).not.toContain('hostFunctionXdrBase64');

    const fnRow = op?.params.find((param) => param.key === 'functionName');
    expect(fnRow?.value).toBe('transfer');
  });

  it('maps invokeHostFunction with zero arguments omits arguments row', () => {
    const wrapped = buildMockInvokeHostFunctionTransaction('init', []);
    const [op] = mapper.mapTransaction(wrapped).operations;

    const keys = op?.params.map((param) => param.key);
    expect(keys).toContain('contractId');
    expect(keys).toContain('functionName');
    expect(keys).not.toContain('arguments');
  });

  it('maps extendFootprintTtl operation', () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), '1');
    const builder = new StellarTransactionBuilder(account, {
      fee: '200',
      networkPassphrase: Networks.TESTNET,
    });
    builder.addOperation(Operation.extendFootprintTtl({ extendTo: 1000 }));
    const wrapped = new Transaction(builder.setTimeout(60).build());
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('extendFootprintTtl');
    expect(op?.classic).toBe(false);
    expect(op?.params).toStrictEqual([
      { key: 'extendTo', value: 1000, type: 'number' },
    ]);
  });

  it('maps restoreFootprint operation', () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), '1');
    const builder = new StellarTransactionBuilder(account, {
      fee: '200',
      networkPassphrase: Networks.TESTNET,
    });
    builder.addOperation(Operation.restoreFootprint({}));
    const wrapped = new Transaction(builder.setTimeout(60).build());
    const [op] = mapper.mapTransaction(wrapped).operations;

    expect(op?.type).toBe('restoreFootprint');
    expect(op?.classic).toBe(false);
    expect(op?.params).toStrictEqual([
      { key: 'note', value: 'Soroban restoreFootprint.', type: 'text' },
    ]);
  });
});
