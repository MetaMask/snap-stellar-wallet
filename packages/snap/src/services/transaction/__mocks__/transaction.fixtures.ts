import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import { TransactionStatus, TransactionType } from '@metamask/keyring-api';
import {
  Account,
  Asset,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder as StellarTransactionBuilder,
  type AuthFlag,
} from '@stellar/stellar-sdk';

import type { KnownCaip19AssetIdOrSlip44Id } from '../../../api';
import { KnownCaip2ChainId } from '../../../api';
import { getSlip44AssetId, logger } from '../../../utils';
import { createMemoryCache } from '../../cache/__mocks__/cache.fixtures';
import { NetworkService } from '../../network';
import { State } from '../../state/State';
import { generateStellarAddress } from '../../wallet/__mocks__/wallet.fixtures';
import { Transaction } from '../Transaction';
import { TransactionBuilder } from '../TransactionBuilder';
import { TransactionRepository } from '../TransactionRepository';
import { TransactionService } from '../TransactionService';

export const createMockTransactionService = () => {
  const networkService = new NetworkService({ logger });
  const transactionBuilder = new TransactionBuilder({ logger });
  const transactionService = new TransactionService({
    logger,
    transactionRepository: new TransactionRepository(
      new State({
        encrypted: false,
        defaultState: {
          transactions: {},
        },
      }),
    ),
    cache: createMemoryCache().cache,
    networkService,
  });

  const transactionRepositorySaveSpy = jest.spyOn(
    TransactionRepository.prototype,
    'save',
  );
  const transactionRepositorySaveManySpy = jest.spyOn(
    TransactionRepository.prototype,
    'saveMany',
  );
  const transactionServiceFindByAccountsSpy = jest.spyOn(
    TransactionService.prototype,
    'findByAccounts',
  );
  return {
    transactionService,
    networkService,
    transactionBuilder,
    transactionRepositorySaveSpy,
    transactionRepositorySaveManySpy,
    transactionServiceFindByAccountsSpy,
  };
};

export type GenerateMockTransactionOverrides = Partial<{
  id: string;
  account: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  asset: {
    type: KnownCaip19AssetIdOrSlip44Id;
    symbol: string;
  };
  scope: KnownCaip2ChainId;
  timestamp: number;
  status: TransactionStatus;
  type: TransactionType;
  fees: KeyringTransaction['fees'];
  events: KeyringTransaction['events'];
}>;

/**
 * Generate mock transactions.
 *
 * @param count - The number of transactions to generate.
 * @param overrides - The overrides for the transactions.
 * @returns The generated transactions.
 */
export function generateMockTransactions(
  count: number = 1,
  overrides: GenerateMockTransactionOverrides = {},
): KeyringTransaction[] {
  return Array.from({ length: count }, () => {
    const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
    const scope = overrides.scope ?? KnownCaip2ChainId.Mainnet;
    const assetType =
      overrides.asset?.type ?? getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const assetSymbol = overrides.asset?.symbol ?? 'XLM';
    const amount = overrides.amount ?? '10000000';

    return {
      type: overrides.type ?? TransactionType.Send,
      id: overrides.id ?? globalThis.crypto.randomUUID(),
      from: [
        {
          address: overrides.fromAddress ?? generateStellarAddress(),
          asset: {
            unit: assetSymbol,
            type: assetType,
            amount,
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: overrides.toAddress ?? generateStellarAddress(),
          asset: {
            unit: assetSymbol,
            type: assetType,
            amount,
            fungible: true,
          },
        },
      ],
      events: overrides.events ?? [
        {
          status: TransactionStatus.Unconfirmed,
          timestamp,
        },
      ],
      chain: scope,
      status: overrides.status ?? TransactionStatus.Unconfirmed,
      account: overrides.account ?? globalThis.crypto.randomUUID(),
      timestamp,
      fees: overrides.fees ?? [],
    };
  });
}

// --- Declarative classic (Stellar) transaction builder for tests ---

/** Asset description without importing Stellar `Asset` at call sites. */
export type MockClassicAssetParam = 'native' | { code: string; issuer: string };

export type MockClassicOperation =
  | {
      type: 'payment';
      params: {
        destination: string;
        asset: MockClassicAssetParam;
        amount: string;
        source?: string;
      };
    }
  | {
      type: 'changeTrust';
      params: {
        asset: MockClassicAssetParam;
        limit: string;
        source?: string;
      };
    }
  | {
      type: 'createAccount';
      params: {
        destination: string;
        startingBalance: string;
        source?: string;
      };
    }
  | {
      type: 'setOptions';
      params: {
        setFlags?: number;
        clearFlags?: number;
        source?: string;
      };
    };

export type BuildMockTransactionOptions = {
  /**
   * Stellar network passphrase for the envelope (defaults to testnet).
   */
  networkPassphrase?: string;
  /**
   * Transaction source account; random key at sequence `1` when omitted.
   */
  source?: { accountId: string; sequence: string };
  /**
   * Max fee per operation (Stellar `TransactionBuilder` `fee` field), in stroops string.
   * Default: `'200'` (matches prior test helper defaults).
   */
  baseFeePerOperation?: string;
  /** Time bound in ledger closes. Default: `60`. */
  timeout?: number;
};

export type MockInvokeHostFunctionArg =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Uint8Array
  | readonly MockInvokeHostFunctionArg[]
  | { readonly [key: string]: MockInvokeHostFunctionArg };

/** Second argument to Stellar `nativeToScVal`, aligned by index with `args`. */
export type MockInvokeHostFunctionArgNativeToScValOptions = Exclude<
  Parameters<typeof nativeToScVal>[1],
  undefined
>;

export type BuildMockInvokeHostFunctionTransactionOptions =
  BuildMockTransactionOptions & {
    /** Soroban contract id (`C…`). */
    contractId?: string;
    /**
     * Optional per-argument second parameter to `nativeToScVal` (e.g. `{ type: 'address' }` for
     * a string Stellar address). Indexes align with the `args` array.
     */
    argNativeToScValOptions?: readonly (
      | MockInvokeHostFunctionArgNativeToScValOptions
      | undefined
    )[];
  };

/**
 * Converts a mock classic asset to a Stellar `Asset`.
 *
 * @param asset - The asset.
 * @returns The Stellar `Asset`.
 */
function mockAssetToSdk(asset: MockClassicAssetParam): Asset {
  if (asset === 'native') {
    return Asset.native();
  }
  return new Asset(asset.code, asset.issuer);
}

/**
 * Appends one classic operation to a Stellar transaction builder.
 *
 * @param builder - In-progress classic transaction builder.
 * @param op - Declarative operation to translate and add.
 */
function addClassicOperationToBuilder(
  builder: StellarTransactionBuilder,
  op: MockClassicOperation,
): void {
  switch (op.type) {
    case 'payment': {
      const { destination, asset, amount, source } = op.params;
      builder.addOperation(
        Operation.payment({
          ...(source === undefined ? {} : { source }),
          destination,
          asset: mockAssetToSdk(asset),
          amount,
        }),
      );
      break;
    }
    case 'changeTrust': {
      const { asset, limit, source } = op.params;
      builder.addOperation(
        Operation.changeTrust({
          ...(source === undefined ? {} : { source }),
          asset: mockAssetToSdk(asset),
          limit,
        }),
      );
      break;
    }
    case 'createAccount': {
      const { destination, startingBalance, source } = op.params;
      builder.addOperation(
        Operation.createAccount({
          ...(source === undefined ? {} : { source }),
          destination,
          startingBalance,
        }),
      );
      break;
    }
    case 'setOptions': {
      const { setFlags, clearFlags, source } = op.params;
      builder.addOperation(
        Operation.setOptions({
          ...(source === undefined ? {} : { source }),
          ...(setFlags === undefined ? {} : { setFlags: setFlags as AuthFlag }),
          ...(clearFlags === undefined
            ? {}
            : { clearFlags: clearFlags as AuthFlag }),
        }),
      );
      break;
    }
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unsupported mock operation: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Builds a mock transaction with a single classic operation.
 *
 * @param operations - The classic operations.
 * @param options - The options for the transaction.
 * @param options.networkPassphrase - The Stellar network passphrase.
 * @param options.source - The source account.
 * @param options.baseFeePerOperation - The base fee per operation.
 * @param options.timeout - The timeout.
 * @returns The mock transaction.
 */
export function buildMockClassicTransaction(
  operations: MockClassicOperation[],
  options: BuildMockTransactionOptions = {},
): Transaction {
  if (operations.length === 0) {
    throw new Error(
      'buildMockClassicTransaction requires at least one operation',
    );
  }

  const passphrase = options.networkPassphrase ?? Networks.TESTNET;
  const sourceAccount =
    options.source ??
    (() => {
      const kp = Keypair.random();
      return { accountId: kp.publicKey(), sequence: '1' };
    })();

  const account = new Account(sourceAccount.accountId, sourceAccount.sequence);
  const builder = new StellarTransactionBuilder(account, {
    fee: options.baseFeePerOperation ?? '200',
    networkPassphrase: passphrase,
  });

  for (const op of operations) {
    addClassicOperationToBuilder(builder, op);
  }

  const built = builder.setTimeout(options.timeout ?? 60).build();
  return new Transaction(built);
}

const DEFAULT_MOCK_SOROBAN_CONTRACT_ID =
  'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT';

/**
 *
 * Converts mock invoke host function arguments to Stellar `xdr.ScVal` values.
 *
 * @param args - The mock invoke host function arguments.
 * @param argNativeToScValOptions - The options for the arguments.
 * @returns The Stellar `xdr.ScVal` values.
 */
function mockInvokeHostFunctionArgsToScVals(
  args: readonly MockInvokeHostFunctionArg[],
  argNativeToScValOptions?: readonly (
    | MockInvokeHostFunctionArgNativeToScValOptions
    | undefined
  )[],
) {
  return args.map((arg, index) => {
    const opts = argNativeToScValOptions?.[index];
    return opts === undefined ? nativeToScVal(arg) : nativeToScVal(arg, opts);
  });
}

/**
 *
 * Builds a mock transaction with a single Soroban `invokeHostFunction` operation.
 *
 * @param functionName - The Soroban function name.
 * @param args - The Soroban arguments.
 * @param options - The options for the transaction.
 * @param options.networkPassphrase - The Stellar network passphrase.
 * @param options.source - The source account.
 * @param options.baseFeePerOperation - The base fee per operation.
 * @param options.timeout - The timeout.
 * @param options.contractId - The Soroban contract id (`C…`).
 * @param options.argNativeToScValOptions - The options for the arguments.
 * @returns The mock transaction.
 */
export function buildMockInvokeHostFunctionTransaction(
  functionName: string,
  args: MockInvokeHostFunctionArg[],
  options: BuildMockInvokeHostFunctionTransactionOptions = {},
): Transaction {
  const passphrase = options.networkPassphrase ?? Networks.TESTNET;
  const sourceAccount =
    options.source ??
    (() => {
      const kp = Keypair.random();
      return { accountId: kp.publicKey(), sequence: '1' };
    })();

  const account = new Account(sourceAccount.accountId, sourceAccount.sequence);
  const builder = new StellarTransactionBuilder(account, {
    fee: options.baseFeePerOperation ?? '200',
    networkPassphrase: passphrase,
  });

  const contract = new Contract(
    options.contractId ?? DEFAULT_MOCK_SOROBAN_CONTRACT_ID,
  );
  const scVals = mockInvokeHostFunctionArgsToScVals(
    args,
    options.argNativeToScValOptions,
  );
  builder.addOperation(contract.call(functionName, ...scVals));

  const built = builder.setTimeout(options.timeout ?? 60).build();
  return new Transaction(built);
}
