import type { Operation } from '@stellar/stellar-sdk';
import {
  Account,
  Asset,
  Keypair,
  nativeToScVal,
  Networks,
  Operation as StellarOperation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverBaseReserveException,
  InsufficientBalanceToCoverFeeException,
  InvalidAmountForCreateAccountException,
  InvalidInvokeContractStructureException,
  RemoveTrustlineWithNonZeroBalanceException,
  TransactionScopeNotMatchException,
  TransactionValidationException,
  TrustlineNotAuthorizedException,
  TrustlineNotFoundException,
  UnsupportedOperationTypeException,
  UpdateTrustlineException,
} from './exceptions';
import { Transaction } from './Transaction';
import {
  SupportedOperations,
  TransactionSimulator,
} from './TransactionSimulator';
import { KnownCaip2ChainId } from '../../api';
import { caip2ChainIdToNetwork } from '../network/utils';
import {
  createMockAccountWithBalances,
  horizonSource,
  type MockAccountWithBalancesData,
} from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import {
  buildMockClassicTransaction,
  buildMockInvokeHostFunctionTransaction,
  type BuildMockTransactionOptions,
} from './__mocks__/transaction.fixtures';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';

const SEP41_ASSET_MAINNET =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as const;

const SEP41_CONTRACT_MAINNET =
  'CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as const;

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Source account used for Soroban `invokeHostFunction` simulator tests (mainnet). */
const SOROBAN_INVOKE_SOURCE =
  'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF';

const MOCK_USDC_ASSET = { code: 'USDC', issuer: USDC_ISSUER } as const;

const SWAP_TEST_CONTRACT_ID =
  'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT';

const MAX_TRUST_LIMIT = '922337203685.4775807';

/**
 * Default {@link buildMockClassicTransaction} / Soroban mock options for mainnet envelopes
 * in this file (matches prior `buildEnvelopeTransaction` fee and time bounds).
 *
 * @param source - The source account id (`G…`).
 * @param sequence - The source sequence number.
 * @param overrides - The overrides for the transaction options.
 * @param overrides.baseFeePerOperation - The base fee per operation.
 * @param overrides.timeout - The timeout.
 * @returns The transaction options.
 */
function mainnetSimulatorTxOptions(
  source: string,
  sequence: string,
  overrides?: Partial<
    Pick<BuildMockTransactionOptions, 'baseFeePerOperation' | 'timeout'>
  >,
): BuildMockTransactionOptions {
  return {
    networkPassphrase: Networks.PUBLIC,
    source: { accountId: source, sequence },
    baseFeePerOperation: overrides?.baseFeePerOperation ?? '100',
    timeout: overrides?.timeout ?? 30,
  };
}

/**
 * Builds a mock transaction with a single Soroban `invokeHostFunction` operation.
 *
 * @returns A {@link Transaction} wrapper.
 */
function buildSoleNonSep41InvokeTx(): Transaction {
  return buildMockInvokeHostFunctionTransaction(
    'swap',
    [
      'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF',
      'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF',
    ],
    {
      ...mainnetSimulatorTxOptions(SOROBAN_INVOKE_SOURCE, '1'),
      contractId: SWAP_TEST_CONTRACT_ID,
      argNativeToScValOptions: [{ type: 'address' }, { type: 'address' }],
    },
  );
}

/**
 * Builds a wrapped transaction with one SEP-41 `transfer(from, to, amount)` invoke (for simulator tests).
 *
 * @param params - Transfer build parameters.
 * @param params.source - Transaction source account id (`G…`).
 * @param params.sequence - Source sequence string.
 * @param params.contractId - Token contract id (`C…`).
 * @param params.from - `transfer` `from` address.
 * @param params.to - `transfer` `to` address.
 * @param params.amountSmallestUnits - Amount in token smallest units (integer string).
 * @param params.feeStroops - Optional fee in stroops.
 * @param params.scope - Optional CAIP-2 chain id (defaults to mainnet).
 * @returns A {@link Transaction} wrapper.
 */
function buildSep41TransferTransaction(params: {
  source: string;
  sequence: string;
  contractId: string;
  from: string;
  to: string;
  amountSmallestUnits: string;
  feeStroops?: string;
  scope?: KnownCaip2ChainId;
}): Transaction {
  const scope = params.scope ?? KnownCaip2ChainId.Mainnet;
  return buildMockInvokeHostFunctionTransaction(
    'transfer',
    [params.from, params.to, params.amountSmallestUnits],
    {
      source: { accountId: params.source, sequence: params.sequence },
      baseFeePerOperation: params.feeStroops ?? '100',
      networkPassphrase: caip2ChainIdToNetwork(scope),
      contractId: params.contractId,
      timeout: 30,
      argNativeToScValOptions: [
        { type: 'address' },
        { type: 'address' },
        { type: 'i128' },
      ],
    },
  );
}

/**
 * Builds a wrapped classic transaction for cases not covered by {@link buildMockClassicTransaction}
 * (empty envelope, `accountMerge`, or Soroban `invokeContractFunction` mixed with classic ops).
 *
 * @param source - Transaction source account public key.
 * @param sequence - Current sequence number string for the source account.
 * @param addOperations - Callback that adds one or more operations to the builder.
 * @param options - Optional builder settings.
 * @param options.feeStroops - Total fee in stroops (string for SDK). Defaults to `100`.
 * @param options.scope - The CAIP-2 chain ID. Defaults to `KnownCaip2ChainId.Mainnet`.
 * @returns A {@link Transaction} wrapper around the built Stellar envelope.
 */
function buildEnvelopeTransaction(
  source: string,
  sequence: string,
  addOperations: (tb: TransactionBuilder) => TransactionBuilder,
  options?: { feeStroops?: string; scope?: KnownCaip2ChainId },
): Transaction {
  const account = new Account(source, sequence);

  const raw = addOperations(
    new TransactionBuilder(account, {
      fee: options?.feeStroops ?? '100',
      networkPassphrase: caip2ChainIdToNetwork(
        options?.scope ?? KnownCaip2ChainId.Mainnet,
      ),
    }),
  )
    .setTimeout(30)
    .build();
  return new Transaction(raw);
}

/**
 * Builds a preloaded destination account with a USDC trustline for {@link TransactionSimulator.simulate}.
 *
 * @param destPublicKey - Payment destination Stellar account id (G…).
 * @returns Horizon-shaped loaded account for preload.
 */
function destOnChainAccount(destPublicKey: string): OnChainAccount {
  return onChainFromMockBalances(destPublicKey, '1', {
    nativeBalance: 50,
    subentryCount: 1,
    assets: [
      {
        assetType: 'credit_alphanum4',
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        balance: 0,
      },
    ],
  });
}

/**
 * Destination with a USDC trustline that exists but is not authorized (`is_authorized` false).
 *
 * @param destPublicKey - Payment destination Stellar account id (G…).
 * @returns Horizon-shaped loaded account for preload.
 */
function destOnChainAccountUnauthorized(destPublicKey: string): OnChainAccount {
  return onChainFromMockBalances(destPublicKey, '1', {
    nativeBalance: 50,
    subentryCount: 1,
    assets: [
      {
        assetType: 'credit_alphanum4',
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        balance: 0,
        isAuthorized: false,
      },
    ],
  });
}

/**
 * Builds {@link OnChainAccount} from {@link createMockAccountWithBalances} with a serializable binding from mock Horizon data.
 *
 * @param accountId - Stellar public key (`G…`).
 * @param sequence - Account sequence string.
 * @param data - Native balance, subentries, and optional trustline mocks.
 * @param scope - CAIP-2 chain (defaults to mainnet).
 * @returns Hydrated on-chain account for simulator tests.
 */
function onChainFromMockBalances(
  accountId: string,
  sequence: string,
  data: MockAccountWithBalancesData,
  scope: KnownCaip2ChainId = KnownCaip2ChainId.Mainnet,
): OnChainAccount {
  const acc = createMockAccountWithBalances(accountId, sequence, data);
  return new OnChainAccount(acc, scope, horizonSource(acc, scope));
}

describe('TransactionSimulator', () => {
  const simulator = new TransactionSimulator();

  describe('preflight validation', () => {
    it('throws when account scope does not match transaction network', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '10',
            },
          },
        ],
        {
          ...mainnetSimulatorTxOptions(wallet.address, '1'),
          networkPassphrase: Networks.TESTNET,
        },
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        TransactionScopeNotMatchException,
      );
    });

    it('throws when the envelope has no operations', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildEnvelopeTransaction(wallet.address, '1', (tb) => tb);
      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        TransactionValidationException,
      );
    });

    it('throws when an operation has an unsupported type (unsupported in preflight)', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildEnvelopeTransaction(wallet.address, '1', (tb) =>
        tb.addOperation(
          StellarOperation.accountMerge({
            source: wallet.address,
            destination: wallet.address,
          }),
        ),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        UnsupportedOperationTypeException,
      );
    });

    it('rejects invokeHostFunction combined with other operations', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildEnvelopeTransaction(wallet.address, '1', (tb) =>
        tb
          .addOperation(
            StellarOperation.payment({
              source: wallet.address,
              destination: dest,
              asset: Asset.native(),
              amount: '1',
            }),
          )
          .addOperation(
            StellarOperation.invokeContractFunction({
              contract: SWAP_TEST_CONTRACT_ID,
              function: 'swap',
              args: [
                nativeToScVal(
                  'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF',
                  {
                    type: 'address',
                  },
                ),
                nativeToScVal(
                  'GDRZ4B4X2GCM3IINPEBUYQXTO2GJX6YDTV5OMLC7TKTGL33WNEKLUSKF',
                  {
                    type: 'address',
                  },
                ),
              ],
            }),
          ),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(InvalidInvokeContractStructureException);
    });

    it('throws when expectedOPTypes omits an operation type on a mixed classic envelope', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '10',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          expectedOPTypes: [SupportedOperations.Payment],
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(TransactionValidationException);
    });
  });

  describe('payment', () => {
    it('succeeds for native payment when destination is preloaded', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '10',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      const stack = simulator.simulate(tx, onChainAccount, {
        preloadedAccounts: [destOnChainAccount(dest)],
      });
      expect(stack).toHaveLength(2);
    });

    it('throws when destination account is not in the simulation set', () => {
      const walletKey = Keypair.random().publicKey();
      const external = Keypair.random().publicKey();
      const loaded = onChainFromMockBalances(walletKey, '1', {
        nativeBalance: 100,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: walletKey,
              destination: external,
              asset: 'native',
              amount: '1',
            },
          },
        ],
        mainnetSimulatorTxOptions(walletKey, '1'),
      );
      expect(() => simulator.simulate(tx, loaded)).toThrow(
        TransactionValidationException,
      );
    });

    it('throws when source spendable native is below payment amount', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 1.01,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '1',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(InsufficientBalanceException);
    });

    it('throws when source has no trustline for a credit asset payment', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: MOCK_USDC_ASSET,
              amount: '1',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(TrustlineNotFoundException);
    });

    it('throws when source trustline is not authorized (is_authorized)', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'USDC',
            assetIssuer: USDC_ISSUER,
            balance: 100,
            isAuthorized: false,
          },
        ],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: MOCK_USDC_ASSET,
              amount: '1',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(TrustlineNotAuthorizedException);
    });

    it('throws when destination trustline is not authorized (is_authorized)', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'USDC',
            assetIssuer: USDC_ISSUER,
            balance: 100,
          },
        ],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: MOCK_USDC_ASSET,
              amount: '1',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccountUnauthorized(dest)],
        }),
      ).toThrow(TrustlineNotAuthorizedException);
    });
  });

  describe('createAccount', () => {
    it('succeeds when funder has enough XLM and destination is absent from state', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'createAccount',
            params: {
              source: wallet.address,
              destination: dest,
              startingBalance: '2',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(simulator.simulate(tx, onChainAccount)).toHaveLength(2);
    });

    it('throws when starting balance is below minimum (1 XLM)', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'createAccount',
            params: {
              source: wallet.address,
              destination: dest,
              startingBalance: '0.5',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        InvalidAmountForCreateAccountException,
      );
    });

    it('throws when destination already exists in simulation state', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'createAccount',
            params: {
              source: wallet.address,
              destination: dest,
              startingBalance: '2',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(TransactionValidationException);
    });
  });

  describe('changeTrust', () => {
    it('succeeds when adding a new trustline and spendable covers base reserve', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(simulator.simulate(tx, onChainAccount)).toHaveLength(2);
    });

    it('throws when adding a trustline but spendable native is below one base reserve', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 1.1,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        InsufficientBalanceToCoverBaseReserveException,
      );
    });

    it('succeeds when removing an existing trustline with zero balance', () => {
      const issuer = Keypair.random().publicKey();
      const removable = { code: 'REM', issuer } as const;
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'REM',
            assetIssuer: issuer,
            balance: 0,
          },
        ],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: removable,
              limit: '0',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(simulator.simulate(tx, onChainAccount)).toHaveLength(2);
    });

    it('throws when removing a trustline that does not exist', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: '0',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        TrustlineNotFoundException,
      );
    });

    it('throws when removing a trustline with non-zero balance', () => {
      const issuer = Keypair.random().publicKey();
      const removable = { code: 'REM', issuer } as const;
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'REM',
            assetIssuer: issuer,
            balance: 10,
          },
        ],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: removable,
              limit: '0',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        RemoveTrustlineWithNonZeroBalanceException,
      );
    });

    it('throws when lowering limit below current asset balance', () => {
      const issuer = Keypair.random().publicKey();
      const line = { code: 'REM', issuer } as const;
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'REM',
            assetIssuer: issuer,
            balance: 10,
          },
        ],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: line,
              limit: '5',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() => simulator.simulate(tx, onChainAccount)).toThrow(
        UpdateTrustlineException,
      );
    });
  });

  describe('invokeHostFunction', () => {
    it('succeeds for sole invoke (fee debit + one op snapshot, no classic balance effects)', () => {
      const sorobanTx = buildSoleNonSep41InvokeTx();
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });

      expect(simulator.simulate(sorobanTx, loaded)).toHaveLength(2);
    });

    it('throws when invoke effective source account is not in simulation state', () => {
      const sorobanTx = buildSoleNonSep41InvokeTx();
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });
      const otherSource = Keypair.random().publicKey();
      const [invokeOp] = sorobanTx.transactionOperations;
      jest
        .spyOn(sorobanTx, 'transactionOperations', 'get')
        .mockReturnValue([{ ...invokeOp, source: otherSource } as Operation]);

      expect(() => simulator.simulate(sorobanTx, loaded)).toThrow(
        TransactionValidationException,
      );
    });

    it('passes preloadedTokenBalance when invoke is SEP-41 transfer and balance covers amount', () => {
      const dest = Keypair.random().publicKey();
      const sorobanTx = buildSep41TransferTransaction({
        source: SOROBAN_INVOKE_SOURCE,
        sequence: '1',
        contractId: SEP41_CONTRACT_MAINNET,
        from: SOROBAN_INVOKE_SOURCE,
        to: dest,
        amountSmallestUnits: '1',
      });
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });

      expect(
        simulator.simulate(sorobanTx, loaded, {
          preloadedTokenBalance: {
            [SOROBAN_INVOKE_SOURCE]: {
              [SEP41_ASSET_MAINNET]: new BigNumber(1_000_000),
            },
          },
        }),
      ).toHaveLength(2);
    });

    it('throws InsufficientBalanceException when SEP-41 transfer amount exceeds preloaded balance', () => {
      const dest = Keypair.random().publicKey();
      const sorobanTx = buildSep41TransferTransaction({
        source: SOROBAN_INVOKE_SOURCE,
        sequence: '1',
        contractId: SEP41_CONTRACT_MAINNET,
        from: SOROBAN_INVOKE_SOURCE,
        to: dest,
        amountSmallestUnits: '10',
      });
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });

      expect(() =>
        simulator.simulate(sorobanTx, loaded, {
          preloadedTokenBalance: {
            [SOROBAN_INVOKE_SOURCE]: {
              [SEP41_ASSET_MAINNET]: new BigNumber(5),
            },
          },
        }),
      ).toThrow(InsufficientBalanceException);
    });

    it('throws when preloadedTokenBalance does not match SEP-41 transfer sender or contract', () => {
      const dest = Keypair.random().publicKey();
      const sorobanTx = buildSep41TransferTransaction({
        source: SOROBAN_INVOKE_SOURCE,
        sequence: '1',
        contractId: SEP41_CONTRACT_MAINNET,
        from: SOROBAN_INVOKE_SOURCE,
        to: dest,
        amountSmallestUnits: '1',
      });
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });
      const other = Keypair.random().publicKey();

      expect(() =>
        simulator.simulate(sorobanTx, loaded, {
          preloadedTokenBalance: {
            [other]: { [SEP41_ASSET_MAINNET]: new BigNumber(100) },
          },
        }),
      ).toThrow(TransactionValidationException);
    });

    it('throws when SEP-41 transfer has no preloaded entry for sender and contract', () => {
      const dest = Keypair.random().publicKey();
      const sorobanTx = buildSep41TransferTransaction({
        source: SOROBAN_INVOKE_SOURCE,
        sequence: '1',
        contractId: SEP41_CONTRACT_MAINNET,
        from: SOROBAN_INVOKE_SOURCE,
        to: dest,
        amountSmallestUnits: '1',
      });
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });

      expect(() => simulator.simulate(sorobanTx, loaded)).toThrow(
        TransactionValidationException,
      );
    });

    it('ignores preloadedTokenBalance when invoke is not a SEP-41 transfer', () => {
      const sorobanTx = buildSoleNonSep41InvokeTx();
      const loaded = onChainFromMockBalances(SOROBAN_INVOKE_SOURCE, '1', {
        nativeBalance: 50,
        subentryCount: 0,
        assets: [],
      });

      expect(
        simulator.simulate(sorobanTx, loaded, {
          preloadedTokenBalance: {
            [SOROBAN_INVOKE_SOURCE]: {
              [SEP41_ASSET_MAINNET]: new BigNumber(1_000_000),
            },
          },
        }),
      ).toHaveLength(2);
    });
  });

  describe('mixed multi-operation flows', () => {
    it('allows createAccount then native payment to the new account', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'createAccount',
            params: {
              source: wallet.address,
              destination: dest,
              startingBalance: '2',
            },
          },
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '5',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(simulator.simulate(tx, onChainAccount)).toHaveLength(3);
    });

    it('allows changeTrust add then native payment when destination is preloaded', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '10',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      const stack = simulator.simulate(tx, onChainAccount, {
        preloadedAccounts: [destOnChainAccount(dest)],
      });
      expect(stack).toHaveLength(3);
    });

    it('throws when payment uses credit asset before changeTrust add in the same tx', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: MOCK_USDC_ASSET,
              amount: '1',
            },
          },
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(() =>
        simulator.simulate(tx, onChainAccount, {
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(TrustlineNotFoundException);
    });

    it('allows mixed changeTrust and payment when expectedOPTypes lists both', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '10',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(
        simulator.simulate(tx, onChainAccount, {
          expectedOPTypes: [
            SupportedOperations.ChangeTrust,
            SupportedOperations.Payment,
          ],
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toHaveLength(3);
    });

    it('allows adding one trustline and removing another in the same transaction', () => {
      const issuerToRemove = Keypair.random().publicKey();
      const removable = { code: 'REM', issuer: issuerToRemove } as const;
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'REM',
            assetIssuer: issuerToRemove,
            balance: 0,
          },
        ],
      });
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: removable,
              limit: '0',
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(simulator.simulate(tx, onChainAccount)).toHaveLength(3);
    });

    it('allows createAccount then native payment then changeTrust add', () => {
      const wallet = getTestWallet();
      const onChainAccount = onChainFromMockBalances(wallet.address, '1', {
        nativeBalance: 500,
        subentryCount: 0,
        assets: [],
      });
      const dest = Keypair.random().publicKey();
      const tx = buildMockClassicTransaction(
        [
          {
            type: 'createAccount',
            params: {
              source: wallet.address,
              destination: dest,
              startingBalance: '2',
            },
          },
          {
            type: 'payment',
            params: {
              source: wallet.address,
              destination: dest,
              asset: 'native',
              amount: '5',
            },
          },
          {
            type: 'changeTrust',
            params: {
              source: wallet.address,
              asset: MOCK_USDC_ASSET,
              limit: MAX_TRUST_LIMIT,
            },
          },
        ],
        mainnetSimulatorTxOptions(wallet.address, '1'),
      );

      expect(
        simulator.simulate(tx, onChainAccount, {
          expectedOPTypes: [
            SupportedOperations.CreateAccount,
            SupportedOperations.Payment,
            SupportedOperations.ChangeTrust,
          ],
        }),
      ).toHaveLength(4);
    });
  });

  describe('fee validation', () => {
    it('fails when spendable native is below the fee even if later ops would free reserve', () => {
      const issuerA = Keypair.random().publicKey();
      const issuerB = Keypair.random().publicKey();
      const sourceKey = Keypair.random().publicKey();
      const dest = Keypair.random().publicKey();

      const loaded = onChainFromMockBalances(sourceKey, '1', {
        nativeBalance: 1.5,
        subentryCount: 2,
        sponsoredCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'AAA',
            assetIssuer: issuerA,
            balance: 0,
          },
          {
            assetType: 'credit_alphanum4',
            assetCode: 'BBB',
            assetIssuer: issuerB,
            balance: 0,
          },
        ],
      });

      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: sourceKey,
              asset: { code: 'AAA', issuer: issuerA },
              limit: '0',
            },
          },
          {
            type: 'changeTrust',
            params: {
              source: sourceKey,
              asset: { code: 'BBB', issuer: issuerB },
              limit: '0',
            },
          },
          {
            type: 'payment',
            params: {
              source: sourceKey,
              destination: dest,
              asset: 'native',
              amount: '0.4',
            },
          },
        ],
        mainnetSimulatorTxOptions(sourceKey, '1', {
          baseFeePerOperation: '300',
        }),
      );

      expect(() =>
        simulator.simulate(tx, loaded, {
          expectedOPTypes: [
            SupportedOperations.ChangeTrust,
            SupportedOperations.Payment,
          ],
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toThrow(InsufficientBalanceToCoverFeeException);
    });

    it('succeeds when spendable native covers the envelope fee (same op sequence as failure case)', () => {
      const issuerA = Keypair.random().publicKey();
      const issuerB = Keypair.random().publicKey();
      const sourceKey = Keypair.random().publicKey();
      const dest = Keypair.random().publicKey();

      const loaded = onChainFromMockBalances(sourceKey, '1', {
        nativeBalance: 1.6,
        subentryCount: 2,
        sponsoredCount: 1,
        assets: [
          {
            assetType: 'credit_alphanum4',
            assetCode: 'AAA',
            assetIssuer: issuerA,
            balance: 0,
          },
          {
            assetType: 'credit_alphanum4',
            assetCode: 'BBB',
            assetIssuer: issuerB,
            balance: 0,
          },
        ],
      });

      const tx = buildMockClassicTransaction(
        [
          {
            type: 'changeTrust',
            params: {
              source: sourceKey,
              asset: { code: 'AAA', issuer: issuerA },
              limit: '0',
            },
          },
          {
            type: 'changeTrust',
            params: {
              source: sourceKey,
              asset: { code: 'BBB', issuer: issuerB },
              limit: '0',
            },
          },
          {
            type: 'payment',
            params: {
              source: sourceKey,
              destination: dest,
              asset: 'native',
              amount: '0.4',
            },
          },
        ],
        mainnetSimulatorTxOptions(sourceKey, '1', {
          baseFeePerOperation: '300',
        }),
      );

      expect(
        simulator.simulate(tx, loaded, {
          expectedOPTypes: [
            SupportedOperations.ChangeTrust,
            SupportedOperations.Payment,
          ],
          preloadedAccounts: [destOnChainAccount(dest)],
        }),
      ).toHaveLength(4);
    });
  });
});
