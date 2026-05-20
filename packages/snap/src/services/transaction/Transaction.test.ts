import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder as StellarTransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { Transaction } from './Transaction';

describe('Transaction', () => {
  it('reports operationCount equal to transactionOperations length for a classic transaction', () => {
    const source = Keypair.random();
    const dest = Keypair.random().publicKey();
    const inner = new StellarTransactionBuilder(
      new Account(source.publicKey(), '1'),
      { fee: '100', networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.payment({
          destination: dest,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(60)
      .build();

    const wrapped = new Transaction(inner);

    expect(wrapped.transactionOperations).toHaveLength(1);
    expect(wrapped.operationCount).toBe(1);
    expect(wrapped.operationCount).toBe(wrapped.transactionOperations.length);
    expect(wrapped.totalFee).toStrictEqual(new BigNumber(inner.fee));
  });

  it('counts inner operations for a fee-bump envelope', () => {
    const source = Keypair.random();
    const feeSource = Keypair.random();
    const dest = Keypair.random().publicKey();

    const inner = new StellarTransactionBuilder(
      new Account(source.publicKey(), '1'),
      { fee: '100', networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.payment({
          destination: dest,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .addOperation(
        Operation.payment({
          destination: dest,
          asset: Asset.native(),
          amount: '2',
        }),
      )
      .setTimeout(60)
      .build();

    const feeBump = StellarTransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      String(Number(inner.fee) * 2),
      inner,
      Networks.TESTNET,
    );

    const wrapped = new Transaction(feeBump);

    expect(wrapped.transactionOperations).toHaveLength(2);
    expect(wrapped.operationCount).toBe(2);
    expect(wrapped.operationCount).toBe(wrapped.transactionOperations.length);
    expect(wrapped.getRaw()).toBeInstanceOf(FeeBumpTransaction);
    expect(wrapped.totalFee).toStrictEqual(new BigNumber(feeBump.fee));
    expect(wrapped.totalFee.toFixed(0)).not.toBe(
      new BigNumber(inner.fee).toFixed(0),
    );
  });

  it('reads memo from inner transaction for a fee-bump envelope', () => {
    const source = Keypair.random();
    const feeSource = Keypair.random();
    const dest = Keypair.random().publicKey();

    const inner = new StellarTransactionBuilder(
      new Account(source.publicKey(), '1'),
      { fee: '100', networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.payment({
          destination: dest,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .addMemo(Memo.text('inner-memo'))
      .setTimeout(60)
      .build();

    const feeBump = StellarTransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      String(Number(inner.fee) * 2),
      inner,
      Networks.TESTNET,
    );

    expect(new Transaction(feeBump).getMemo()).toBe('inner-memo');
  });

  it.each([
    {
      memo: Memo.text('english'),
      expected: 'english',
    },
    {
      memo: Memo.text(''),
      expected: '',
    },
    {
      memo: Memo.text('🧾 éclair'),
      expected: '🧾 éclair',
    },
    {
      memo: Memo.id('12321'),
      expected: '12321',
    },
    {
      memo: Memo.id('0'),
      expected: '0',
    },
    {
      memo: Memo.hash(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ),
      expected:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    {
      memo: Memo.return(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ),
      expected:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    {
      memo: Memo.none(),
      expected: null,
    },
  ])(
    'decodes memo values correctly',
    ({ memo, expected }: { memo: Memo; expected: string | null }) => {
      const source = Keypair.random();
      const dest = Keypair.random().publicKey();
      const inner = new StellarTransactionBuilder(
        new Account(source.publicKey(), '1'),
        { fee: '100', networkPassphrase: Networks.TESTNET },
      )
        .addOperation(
          Operation.payment({
            destination: dest,
            asset: Asset.native(),
            amount: '1',
          }),
        )
        .addMemo(memo)
        .setTimeout(60)
        .build();

      const wrapped = new Transaction(inner);
      expect(wrapped.getMemo()).toStrictEqual(expected);
    },
  );
});
