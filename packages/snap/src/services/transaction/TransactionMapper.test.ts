import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import {
  FeeType,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';
import type { Horizon } from '@stellar/stellar-sdk';
import { Networks } from '@stellar/stellar-sdk';

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
  swapTransactionPathReceiveResponse,
  swapTransactionPathReceiveWithStrictPathResponse,
  receivePaymentTransactionPathReceiveResponse,
  sep41SendTransactionResponse,
} from './__mocks__/horizon-transaction-responses.fixtures';
import {
  buildMockClassicTransaction,
  generateMockTransactions,
} from './__mocks__/transaction.fixtures';
import { StellarOperationType } from './api';
import { KeyringTransactionBuilder } from './KeyringTransactionBuilder';
import { Transaction } from './Transaction';
import { TransactionMapper } from './TransactionMapper';
import * as transactionUtils from './utils';
import { KnownCaip2ChainId } from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  getSlip44AssetId,
  removeTrailingZeros,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  toDisplayBalance,
} from '../../utils';
import { logger } from '../../utils/logger';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import type { StellarAssetMetadata } from '../asset-metadata/api';
import { toStellarAssetMetadata } from '../asset-metadata/utils';

jest.mock('../../utils/logger');

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
  const sep41AssetId = toCaip19Sep41AssetId(
    scope,
    'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN',
  );
  const sep41AssetMetadata: StellarAssetMetadata = toStellarAssetMetadata({
    assetId: sep41AssetId,
    decimals: 8,
    symbol: 'SolvBTC',
  });

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
      logger,
    });

    return { keyringAccount, transactionMapper };
  };

  const nativeAsset = getSlip44AssetId(scope);

  const horizonCreatedAtSeconds = (createdAt: string): number =>
    Math.floor(new Date(createdAt).getTime() / 1000);

  const expectedBaseFees = (transaction: Transaction) => [
    {
      type: FeeType.Base,
      asset: {
        unit: NATIVE_ASSET_SYMBOL,
        type: nativeAsset,
        amount: toDisplayBalance(transaction.feeCharged),
        fungible: true,
      },
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('maps to unknown when transaction raw data is missing', () => {
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

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction: built,
      keyringAccount,
      assetMetadata: {},
    });

    expect(keyringTransaction).toStrictEqual({
      type: TransactionType.Unknown,
      id: built.id,
      from: [],
      to: [],
      events: [
        {
          status: built.status,
          timestamp: horizonCreatedAtSeconds('2026-01-15T00:00:00.000Z'),
        },
      ],
      chain: scope,
      status: built.status,
      account: keyringAccount.id,
      timestamp: horizonCreatedAtSeconds('2026-01-15T00:00:00.000Z'),
      fees: expectedBaseFees(built),
    });
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
      toAmount: '0.5257447',
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
      toAmount: '0.1579988',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Swap,
    },
    {
      testCase: 'swap transaction via path payment strict receive',
      response: swapTransactionPathReceiveResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '0.19816',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'AQUA',
        'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
      ),
      toAssetSymbol: 'AQUA',
      toAmount: '100',
      toAddress: accountAddress,
      fromAddress: accountAddress,
      txnType: TransactionType.Swap,
    },
    {
      testCase:
        'swap transaction via path payment strict receive (strict path)',
      response: swapTransactionPathReceiveWithStrictPathResponse,
      fromAsset: nativeAsset,
      fromAssetSymbol: NATIVE_ASSET_SYMBOL,
      fromAmount: '0.1992969',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'AQUA',
        'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
      ),
      toAssetSymbol: 'AQUA',
      toAmount: '100',
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
      txnType: TransactionType.TokenApprove,
      details: {
        typeLabel: 'trustline-approve',
      },
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
      txnType: TransactionType.TokenDisapprove,
      details: {
        typeLabel: 'trustline-disapprove',
      },
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
      testCase: 'send transaction via SEP-41 transfer',
      response: sep41SendTransactionResponse,
      fromAsset: sep41AssetId,
      fromAssetSymbol: 'SolvBTC',
      fromAmount: '0.00000004',
      toAsset: sep41AssetId,
      toAssetSymbol: 'SolvBTC',
      toAmount: '0.00000004',
      toAddress: 'GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU',
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

    {
      testCase: 'receive payment transaction via path payment strict receive',
      response: receivePaymentTransactionPathReceiveResponse,
      fromAsset: toCaip19ClassicAssetId(
        scope,
        'AQUA',
        'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
      ),
      fromAssetSymbol: 'AQUA',
      fromAmount: '100',
      toAsset: toCaip19ClassicAssetId(
        scope,
        'AQUA',
        'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
      ),
      toAssetSymbol: 'AQUA',
      toAmount: '100',
      toAddress: accountAddress,
      fromAddress: 'GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU',
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
      details,
    }) => {
      const { keyringAccount, transactionMapper } = setup();

      const transaction = Transaction.fromHorizon({
        horizonTransaction: response,
        scope,
      });

      const keyringTransaction = transactionMapper.mapTransactionSafe({
        transaction,
        keyringAccount,
        assetMetadata: {
          [sep41AssetId]: sep41AssetMetadata,
        },
      });

      const timestamp = horizonCreatedAtSeconds(response.created_at);

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
        fees: expectedBaseFees(transaction),
        // eslint-disable-next-line jest/no-conditional-in-test
        ...(details ? { details } : {}),
      });
    },
  );

  it('maps as send before swap when both matchers would apply', () => {
    const swapSpy = jest
      .spyOn(transactionUtils, 'isSwapTransaction')
      .mockReturnValue(true);
    const { keyringAccount, transactionMapper } = setup();
    const transaction = Transaction.fromHorizon({
      horizonTransaction: sendTransactionResponse,
      scope,
    });

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
    });

    expect(
      transactionUtils.isSendTransaction(transaction, accountAddress),
    ).toBe(true);
    expect(keyringTransaction?.type).toBe(TransactionType.Send);
    expect(swapSpy).not.toHaveBeenCalled();
  });

  it.each([contractInvokeTransactionResponse])(
    'maps an unrecognized transaction as unknown',
    (response) => {
      const { keyringAccount, transactionMapper } = setup();

      const transaction = Transaction.fromHorizon({
        horizonTransaction: response,
        scope,
      });

      const keyringTransaction = transactionMapper.mapTransactionSafe({
        transaction,
        keyringAccount,
        assetMetadata: {},
      });

      const timestamp = horizonCreatedAtSeconds(response.created_at);

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
        fees: expectedBaseFees(transaction),
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
      transactionMapper.mapTransactionSafe({
        transaction,
        keyringAccount,
        assetMetadata: {},
      }),
    ).toBeUndefined();
  });

  it('returns undefined for failed receive transactions', () => {
    const { keyringAccount, transactionMapper } = setup();

    const transaction = Transaction.fromHorizon({
      horizonTransaction: {
        ...receivePaymentTransactionResponse,
        successful: false,
      },
      scope,
    });

    expect(
      transactionMapper.mapTransactionSafe({
        transaction,
        keyringAccount,
        assetMetadata: {},
      }),
    ).toBeUndefined();
  });

  it('falls back to destMin for swap when result_xdr is missing', () => {
    const { keyringAccount, transactionMapper } = setup();

    const transaction = Transaction.fromHorizon({
      horizonTransaction: {
        ...swapTransactionWithoutFeeCollectResponse,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
        result_xdr: undefined as unknown as string,
      },
      scope,
    });

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
    });

    const swapOperation = transaction.transactionOperations.find(
      (operation) =>
        operation.type === StellarOperationType.PathPaymentStrictSend,
    );
    expect(swapOperation).toMatchObject({
      type: StellarOperationType.PathPaymentStrictSend,
    });

    const { destMin } = swapOperation as { destMin: string };

    expect(keyringTransaction?.to[0]?.asset).toMatchObject({
      fungible: true,
      amount: removeTrailingZeros(destMin),
    });
    expect(keyringTransaction?.to[0]?.asset).not.toMatchObject({
      amount: '0.1579988',
    });
  });

  it('uses result_xdr amount for path payment strict send receive', () => {
    const { keyringAccount, transactionMapper } = setup();
    const externalSource =
      'GCLVE5C7MNJRQCUM5AOKJT64SKNPKHW2VZL4VVS7EKDVYWIDUN5PECZW';
    const usdcIssuer =
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

    const built = buildMockClassicTransaction(
      [
        {
          type: 'pathPaymentStrictSend',
          params: {
            sendAsset: { code: 'USDC', issuer: usdcIssuer },
            sendAmount: '1',
            destination: accountAddress,
            destAsset: 'native',
            destMin: '0.1',
          },
        },
      ],
      {
        networkPassphrase: Networks.PUBLIC,
        source: { accountId: externalSource, sequence: '1' },
      },
    );
    const transaction = Transaction.fromHorizon({
      horizonTransaction: toHorizonTransaction(built, {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Horizon API field names
        result_xdr: swapTransactionWithoutFeeCollectResponse.result_xdr,
      }),
      scope,
    });

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
    });

    expect(keyringTransaction?.type).toBe(TransactionType.Receive);
    expect(keyringTransaction?.to[0]?.asset).toMatchObject({
      fungible: true,
      amount: '0.1579988',
    });
    expect(keyringTransaction?.to[0]?.asset).not.toMatchObject({
      amount: '0.1',
    });
  });

  it('merges pending state when transactionFromState is provided', () => {
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
    const confirmedTimestamp = horizonCreatedAtSeconds(
      '2026-01-15T00:00:00.000Z',
    );

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
      transactionFromState: pendingFromState,
    });

    expect(keyringTransaction).toStrictEqual({
      ...pendingFromState,
      status: TransactionStatus.Confirmed,
      fees: expectedBaseFees(transaction),
      events: [
        ...pendingFromState.events,
        { status: TransactionStatus.Confirmed, timestamp: confirmedTimestamp },
      ],
    });
  });

  it('refreshes swap from/to from on-chain data when merging pending swap state', () => {
    const { keyringAccount, transactionMapper } = setup();
    const response = swapTransactionWithoutFeeCollectResponse;
    const transaction = Transaction.fromHorizon({
      horizonTransaction: response,
      scope,
    });
    const [pendingFromState] = generateMockTransactions(1, {
      id: transaction.id,
      account: keyringAccount.id,
      scope,
      type: TransactionType.Swap,
      status: TransactionStatus.Unconfirmed,
      timestamp: 1700000000,
      amount: '999',
    }) as [KeyringTransaction];
    const onChainSwap = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
    });

    const keyringTransaction = transactionMapper.mapTransactionSafe({
      transaction,
      keyringAccount,
      assetMetadata: {},
      transactionFromState: pendingFromState,
    });

    expect(onChainSwap?.from).toStrictEqual([
      {
        address: accountAddress,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: nativeAsset,
          amount: '1',
          fungible: true,
        },
      },
    ]);
    expect(keyringTransaction).toStrictEqual({
      ...pendingFromState,
      from: onChainSwap?.from,
      to: onChainSwap?.to,
      status: TransactionStatus.Confirmed,
      fees: expectedBaseFees(transaction),
      events: [
        ...pendingFromState.events,
        {
          status: TransactionStatus.Confirmed,
          timestamp: horizonCreatedAtSeconds(response.created_at),
        },
      ],
    });
  });
});
