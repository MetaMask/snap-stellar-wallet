import {
  FeeType,
  TransactionStatus,
  TransactionType,
} from '@metamask/keyring-api';

import { KeyringTransactionBuilderException } from './exceptions';
import {
  KeyringTransactionBuilder,
  KeyringTransactionType,
} from './KeyringTransactionBuilder';
import { KnownCaip2ChainId } from '../../api';
import type { StellarKeyringAccount } from '../account/api';

describe('KeyringTransactionBuilder', () => {
  const mockNow = new Date('2026-01-15T00:00:00.000Z').getTime();
  const fixedTimestamp = Math.floor(mockNow / 1000);

  const account = {
    id: 'account-id-1',
    address: 'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO',
  } as StellarKeyringAccount;
  const scope = KnownCaip2ChainId.Mainnet;
  const nativeAsset = (amount: string) =>
    ({
      type: 'stellar:pubnet/slip44:148' as const,
      unit: 'XLM',
      amount,
      fungible: true as const,
    }) as const;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockNow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a send transaction with expected keyring fields', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.Send,
      request: {
        txId: 'tx-send-1',
        account,
        scope,
        toAddress: 'GBQ67YZIDIMGS4UE2VXW4BBLRW6QJJQ6D6L5AXR5TBKX2L6IY3LCLTTR',
        asset: nativeAsset('1230000'),
      },
    });

    expect(transaction).toStrictEqual({
      type: TransactionType.Send,
      id: 'tx-send-1',
      from: [
        {
          address: account.address,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '1230000',
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: 'GBQ67YZIDIMGS4UE2VXW4BBLRW6QJJQ6D6L5AXR5TBKX2L6IY3LCLTTR',
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '1230000',
            fungible: true,
          },
        },
      ],
      events: [
        { status: TransactionStatus.Unconfirmed, timestamp: fixedTimestamp },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp: fixedTimestamp,
      fees: [],
    });
  });

  it('creates changeTrust opt-in transaction with default unconfirmed status', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.ChangeTrustOptIn,
      request: {
        txId: 'tx-opt-in-1',
        account,
        scope,
        asset: {
          type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          unit: 'USDC',
          amount: '0',
          fungible: true as const,
        },
      },
    });

    expect(transaction.type).toBe(TransactionType.Unknown);
    expect(transaction.id).toBe('tx-opt-in-1');
    expect(transaction.status).toBe(TransactionStatus.Unconfirmed);
    expect(transaction.events).toStrictEqual([
      { status: TransactionStatus.Unconfirmed, timestamp: fixedTimestamp },
    ]);
    expect(transaction.from).toStrictEqual([
      {
        address: account.address,
        asset: {
          unit: 'USDC',
          type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amount: '0',
          fungible: true,
        },
      },
    ]);
    expect(transaction.to).toStrictEqual([
      {
        address: account.address,
        asset: {
          unit: 'USDC',
          type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amount: '0',
          fungible: true,
        },
      },
    ]);
  });

  it('creates changeTrust opt-out transaction with caller-provided status', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.ChangeTrustOptOut,
      request: {
        txId: 'tx-opt-out-1',
        account,
        scope,
        status: TransactionStatus.Confirmed,
        asset: {
          type: 'stellar:pubnet/asset:USDT-GCEZWKPH6X7R2SDYB7V4LGAU5N5LE6L4P7J6LQEXAMPLE1234567890',
          unit: 'USDT',
          amount: '0',
          fungible: true as const,
        },
      },
    });

    expect(transaction.type).toBe(TransactionType.Unknown);
    expect(transaction.status).toBe(TransactionStatus.Confirmed);
    expect(transaction.events).toStrictEqual([
      { status: TransactionStatus.Confirmed, timestamp: fixedTimestamp },
    ]);
    expect(transaction.from).toStrictEqual([
      {
        address: account.address,
        asset: {
          unit: 'USDT',
          type: 'stellar:pubnet/asset:USDT-GCEZWKPH6X7R2SDYB7V4LGAU5N5LE6L4P7J6LQEXAMPLE1234567890',
          amount: '0',
          fungible: true,
        },
      },
    ]);
    expect(transaction.to).toStrictEqual([
      {
        address: account.address,
        asset: {
          unit: 'USDT',
          type: 'stellar:pubnet/asset:USDT-GCEZWKPH6X7R2SDYB7V4LGAU5N5LE6L4P7J6LQEXAMPLE1234567890',
          amount: '0',
          fungible: true,
        },
      },
    ]);
  });

  it('creates a pending transaction as an unknown activity entry', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.Pending,
      request: {
        txId: 'tx-pending-1',
        account,
        scope,
        asset: {
          type: 'stellar:pubnet/slip44:148',
          symbol: 'XLM',
        },
      },
    });

    expect(transaction).toStrictEqual({
      type: TransactionType.Unknown,
      id: 'tx-pending-1',
      from: [
        {
          address: account.address,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '0',
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: account.address,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '0',
            fungible: true,
          },
        },
      ],
      events: [
        { status: TransactionStatus.Unconfirmed, timestamp: fixedTimestamp },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp: fixedTimestamp,
      fees: [],
    });
  });

  it('creates a swap transaction with expected keyring fields', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.Swap,
      request: {
        txId: 'tx-swap-1',
        account,
        scope,
        toAddress: account.address,
        fromAsset: nativeAsset('10000000'),
        toAsset: {
          type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          unit: 'USDC',
          amount: '5000000',
          fungible: true as const,
        },
      },
    });

    expect(transaction).toStrictEqual({
      type: TransactionType.Swap,
      id: 'tx-swap-1',
      from: [
        {
          address: account.address,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '10000000',
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: account.address,
          asset: {
            unit: 'USDC',
            type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            amount: '5000000',
            fungible: true,
          },
        },
      ],
      events: [
        { status: TransactionStatus.Unconfirmed, timestamp: fixedTimestamp },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp: fixedTimestamp,
      fees: [],
    });
  });

  it('creates a detailed pending transaction when transaction details are available', () => {
    const builder = new KeyringTransactionBuilder();

    const transaction = builder.createTransaction({
      type: KeyringTransactionType.Pending,
      request: {
        txId: 'tx-pending-swap-1',
        account,
        scope,
        transactionType: TransactionType.Swap,
        from: [
          {
            address: account.address,
            asset: {
              unit: 'XLM',
              type: 'stellar:pubnet/slip44:148',
              amount: '10',
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: account.address,
            asset: {
              unit: 'USDC',
              type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              amount: '5',
              fungible: true,
            },
          },
        ],
        fees: [
          {
            type: FeeType.Base,
            asset: {
              unit: 'XLM',
              type: 'stellar:pubnet/slip44:148',
              amount: '0.00002',
              fungible: true,
            },
          },
        ],
      },
    });

    expect(transaction).toStrictEqual({
      type: TransactionType.Swap,
      id: 'tx-pending-swap-1',
      from: [
        {
          address: account.address,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '10',
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: account.address,
          asset: {
            unit: 'USDC',
            type: 'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            amount: '5',
            fungible: true,
          },
        },
      ],
      events: [
        { status: TransactionStatus.Unconfirmed, timestamp: fixedTimestamp },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp: fixedTimestamp,
      fees: [
        {
          type: FeeType.Base,
          asset: {
            unit: 'XLM',
            type: 'stellar:pubnet/slip44:148',
            amount: '0.00002',
            fungible: true,
          },
        },
      ],
    });
  });

  it('throws KeyringTransactionBuilderException for unsupported type', () => {
    const builder = new KeyringTransactionBuilder();

    expect(() =>
      builder.createTransaction({
        type: 'unsupported-type' as never,
        request: {} as never,
      }),
    ).toThrow(KeyringTransactionBuilderException);
  });
});
