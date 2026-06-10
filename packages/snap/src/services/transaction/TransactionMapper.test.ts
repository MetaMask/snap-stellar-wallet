import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import {
  FeeType,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';
import type { Horizon } from '@stellar/stellar-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  addChangeTrustResponse,
  removeChangeTrustResponse,
  swapTransactionWithFeeCollectResponse,
  swapTransactionWithoutFeeCollectResponse,
  contractInvokeTransactionResponse,
  sendTransactionResponse,
  spamTransactionResponse,
  createAccountTransactionResponse,
  receivePaymentTransactionResponse,
  receiveCreateAccountTransactionResponse,
} from './__mocks__/horizon-transaction-responses.fixtures';
import {
  buildMockClassicTransaction,
  generateMockTransactions,
} from './__mocks__/transaction.fixtures';
import { TransactionMapperException } from './exceptions';
import { KeyringTransactionBuilder } from './KeyringTransactionBuilder';
import { Transaction } from './Transaction';
import { TransactionMapper } from './TransactionMapper';
import { KnownCaip2ChainId } from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toDisplayBalance,
} from '../../utils';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';

function toHorizonTransaction(
  transaction: Transaction,
  overrides: Partial<Horizon.ServerApi.TransactionRecord> = {},
): Horizon.ServerApi.TransactionRecord {
  const inner = transaction.getRaw();

  return {
    id: inner.hash().toString('hex'),
    hash: inner.hash().toString('hex'),
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
    envelope_xdr: inner.toXDR(),
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
    fee_charged: inner.fee,
    successful: true,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
    created_at: '2026-01-15T00:00:00.000Z',
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
    paging_token: 'scan-token-1',
    ...overrides,
  } as Horizon.ServerApi.TransactionRecord;
}

describe('TransactionMapper', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const accountAddress =
    'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
  const destinationAddress =
    'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';

  const setup = () => {
    const keyringAccount = generateStellarKeyringAccount(
      'account-id-1',
      accountAddress,
      'test-entropy',
      0,
    );

    const keyringTransactionBuilder = new KeyringTransactionBuilder();
    const transactionMapper = new TransactionMapper({
      keyringTransactionBuilder,
    });

    return { keyringAccount, transactionMapper };
  };

  const nativeAsset = getSlip44AssetId(scope);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws when transaction raw data is missing', () => {
    const { keyringAccount, transactionMapper } = setup();
    const built = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: destinationAddress,
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: { accountId: accountAddress, sequence: '1' },
      },
    );

    expect(() =>
      transactionMapper.mapTransaction({
        transaction: built,
        keyringAccount,
      }),
    ).toThrow(TransactionMapperException);
  });

  it.each([
    {
      testCase: 'swap transaction with fee collect',
      response: swapTransactionWithFeeCollectResponse,
      fromAsset: toCaip19ClassicAssetId(
        scope,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
      fromAssetSymbol: 'USDC',
      fromAmount: '0.1',
      toAsset: nativeAsset,
      toAssetSymbol: NATIVE_ASSET_SYMBOL,
      toAmount: '0.5152298',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Swap,
    },
    {
      testCase: 'swap transaction without fee collect',
      response: swapTransactionWithoutFeeCollectResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '1',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ),
      toAssetSymbol: 'USDC',
      toAmount: '0.1564188',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Swap,
    },
    {
      testCase: 'add change trust transaction',
      response: addChangeTrustResponse,
      fromAsset: toCaip19ClassicAssetId(
        scope,
        'AFR',
        'GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W',
      ),
      fromAssetSymbol: 'AFR',
      fromAmount: '0',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'AFR',
        'GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W',
      ),
      toAssetSymbol: 'AFR',
      toAmount: '0',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Unknown,
    },
    {
      testCase: 'remove change trust transaction',
      response: removeChangeTrustResponse,
      fromAsset: toCaip19ClassicAssetId(
        scope,
        'AFR',
        'GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W',
      ),
      fromAssetSymbol: 'AFR',
      fromAmount: '0',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'AFR',
        'GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W',
      ),
      toAssetSymbol: 'AFR',
      toAmount: '0',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Unknown,
    },
    {
      testCase: 'send transaction',
      response: sendTransactionResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '0.00001',
      toAsset: nativeAsset,
      toAssetSymbol: NATIVE_ASSET_SYMBOL,
      toAmount: '0.00001',
      toAddress: 'GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU',
      fromAddress: accountAddress,
      txnType: TransactionType.Send,
    },
    {
      testCase: 'send transaction via create account',
      response: createAccountTransactionResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '3',
      toAsset: nativeAsset,
      toAssetSymbol: NATIVE_ASSET_SYMBOL,
      toAmount: '3',
      toAddress: 'GCLVE5C7MNJRQCUM5AOKJT64SKNPKHW2VZL4VVS7EKDVYWIDUN5PECZW',
      fromAddress: accountAddress,
      txnType: TransactionType.Send,
    },
    {
      testCase: 'receive payment transaction',
      response: receivePaymentTransactionResponse,
      fromAsset: toCaip19ClassicAssetId(
        scope,
        'SHX',
        'GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH',
      ),
      fromAssetSymbol: 'SHX',
      fromAmount: '5',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'SHX',
        'GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH',
      ),
      toAssetSymbol: 'SHX',
      toAmount: '5',
      toAddress: accountAddress,
      fromAddress: 'GCLVE5C7MNJRQCUM5AOKJT64SKNPKHW2VZL4VVS7EKDVYWIDUN5PECZW',
      txnType: TransactionType.Receive,
    },
    {
      testCase: 'receive payment transaction via create account',
      response: receiveCreateAccountTransactionResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '11.76',
      toAsset: nativeAsset,
      toAssetSymbol: NATIVE_ASSET_SYMBOL,
      toAmount: '11.76',
      toAddress: accountAddress,
      fromAddress: 'GCXZDLDI4BO3RHIYBS22RZXB5LGRRLTZUSPG6ANQQ36TVL2ASHC4ONZO',
      txnType: TransactionType.Receive,
    },
  ])(
    'maps a $testCase from Horizon',
    ({
      response,
      fromAsset,
      fromAssetSymbol,
      fromAmount,
      toAsset,
      toAssetSymbol,
      toAmount,
      txnType,
      fromAddress,
      toAddress,
    }) => {
      const { keyringAccount, transactionMapper } = setup();

      const transaction = Transaction.fromHorizon({
        horizonTransaction: response,
        scope,
      });

      const keyringTransaction = transactionMapper.mapTransaction({
        transaction,
        keyringAccount,
      });

      const timestamp = new Date(response.created_at).getTime() / 1000;

      expect(keyringTransaction).toStrictEqual({
        type: txnType,
        id: response.id,
        from: [
          {
            address: fromAddress,
            asset: {
              unit: fromAssetSymbol,
              type: fromAsset,
              amount: fromAmount,
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: toAddress,
            asset: {
              unit: toAssetSymbol,
              type: toAsset,
              amount: toAmount,
              fungible: true,
            },
          },
        ],
        events: [{ status: TransactionStatus.Confirmed, timestamp }],
        chain: scope,
        status: TransactionStatus.Confirmed,
        account: keyringAccount.id,
        timestamp,
        fees: [
          {
            type: FeeType.Base,
            asset: {
              unit: NATIVE_ASSET_SYMBOL,
              type: nativeAsset,
              amount: toDisplayBalance(new BigNumber(response.fee_charged)),
              fungible: true,
            },
          },
        ],
      });
    },
  );

  it.each([contractInvokeTransactionResponse])(
    'maps an unrecognized transaction as unknown',
    (response) => {
      const { keyringAccount, transactionMapper } = setup();

      const transaction = Transaction.fromHorizon({
        horizonTransaction: response,
        scope,
      });

      const keyringTransaction = transactionMapper.mapTransaction({
        transaction,
        keyringAccount,
      });

      const timestamp = new Date(response.created_at).getTime() / 1000;

      expect(keyringTransaction).toStrictEqual({
        type: TransactionType.Unknown,
        id: transaction.id,
        from: [],
        to: [],
        events: [{ status: TransactionStatus.Confirmed, timestamp }],
        chain: scope,
        status: TransactionStatus.Confirmed,
        account: keyringAccount.id,
        timestamp,
        fees: [
          {
            type: FeeType.Base,
            asset: {
              unit: NATIVE_ASSET_SYMBOL,
              type: nativeAsset,
              amount: toDisplayBalance(new BigNumber(response.fee_charged)),
              fungible: true,
            },
          },
        ],
      });
    },
  );

  it('returns undefined for spam transactions', () => {
    const { keyringAccount, transactionMapper } = setup();

    const transaction = Transaction.fromHorizon({
      horizonTransaction: spamTransactionResponse,
      scope,
    });

    expect(
      transactionMapper.mapTransaction({
        transaction,
        keyringAccount,
      }),
    ).toBeUndefined();
  });

  it('merges pending state when transcationFromState is provided', () => {
    const { keyringAccount, transactionMapper } = setup();
    const built = buildMockClassicTransaction(
      [
        {
          type: 'payment',
          params: {
            destination: destinationAddress,
            asset: 'native',
            amount: '1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: { accountId: accountAddress, sequence: '1' },
      },
    );
    const transaction = Transaction.fromHorizon({
      horizonTransaction: toHorizonTransaction(built),
      scope,
    });
    const [pendingFromState] = generateMockTransactions(1, {
      id: transaction.id,
      account: keyringAccount.id,
      scope,
      type: TransactionType.Send,
      status: TransactionStatus.Unconfirmed,
      timestamp: 1700000000,
    }) as [KeyringTransaction];

    const keyringTransaction = transactionMapper.mapTransaction({
      transaction,
      keyringAccount,
      transcationFromState: pendingFromState,
    });

    expect(keyringTransaction).toStrictEqual({
      ...pendingFromState,
      status: TransactionStatus.Confirmed,
      fees: [
        {
          type: FeeType.Base,
          asset: {
            unit: NATIVE_ASSET_SYMBOL,
            type: nativeAsset,
            amount: '0.00002',
            fungible: true,
          },
        },
      ],
      events: [
        ...pendingFromState.events,
        { status: TransactionStatus.Confirmed, timestamp: 1768435200 },
      ],
    });
  });
});
