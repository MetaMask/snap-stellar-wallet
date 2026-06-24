import { parseCaipAssetType } from '@metamask/utils';
import {
  Address,
  Contract,
  Horizon as StellarHorizon,
  NotFoundError,
  rpc,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { AssetDataResponse } from './api';
import { KnownRpcError } from './api';
import {
  AccountNotActivatedException,
  NetworkServiceException,
  SimulationException,
  TransactionNotFoundException,
  TransactionPollException,
  TransactionRetryableException,
  TransactionSendException,
} from './exceptions';
import {
  InvocationV1,
  MultiCall,
  SIMULATION_ACCOUNT,
  StellarRouterContract,
} from './MultiCall';
import { isAccountNotFoundError, multiplyFee, sep41MulticallCellToBalance } from './utils';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
} from '../../api';
import { KnownCaip2ChainId } from '../../api';
import type { NetworkConfig } from '../../config';
import { AppConfig } from '../../config';
import {
  MAX_TRANSACTION_SCAN_PAGES,
  MAX_TRANSACTIONS_PAGE_SIZE,
  STELLAR_DECIMAL_PLACES,
} from '../../constants';
import type { AnyErrorConstructor, ILogger, Serializable } from '../../utils';
import {
  isSameStr,
  createPrefixedLogger,
  parseClassicAssetCodeIssuer,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  rethrowIfInstanceElseThrow,
  batchesAllSettled,
} from '../../utils';
import type { ICache } from '../cache';
import { useCache } from '../cache';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import { InvalidInvokeContractStructureException } from '../transaction/exceptions';
import { Transaction } from '../transaction/Transaction';
import { assertInvokeHostFunctionSoleOperation } from '../transaction/utils';
import { extractAssetDataFromContractData } from '../transaction/xdrParser';

/**
 * Stellar network access through **Horizon** and **Soroban RPC**: base fee, account loading (full
 * Horizon account vs RPC sequence-only), contract token metadata (`getLedgerEntries`), SEP-41
 * balance simulation, Soroban simulation / fee computation, transaction submission, and optional
 * post-submit polling.
 */
export class NetworkService {
  readonly #logger: ILogger;

  readonly #cache: ICache<Serializable>;

  readonly #horizonClientMap = new Map<
    KnownCaip2ChainId,
    StellarHorizon.Server
  >();

  readonly #rpcClientMap = new Map<KnownCaip2ChainId, rpc.Server>();

  constructor({
    logger,
    cache,
  }: {
    logger: ILogger;
    cache: ICache<Serializable>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🌐 NetworkService]');
    this.#cache = cache;
  }

  #getHorizonClient(scope: KnownCaip2ChainId): StellarHorizon.Server {
    let client = this.#horizonClientMap.get(scope);
    if (!client) {
      client = new StellarHorizon.Server(
        this.#getNetworkConfig(scope).horizonUrl,
      );
      this.#horizonClientMap.set(scope, client);
    }
    return client;
  }

  #getRpcClient(scope: KnownCaip2ChainId): rpc.Server {
    let client = this.#rpcClientMap.get(scope);
    if (!client) {
      client = new rpc.Server(this.#getNetworkConfig(scope).rpcUrl);
      this.#rpcClientMap.set(scope, client);
    }
    return client;
  }

  #getNetworkConfig(scope: KnownCaip2ChainId): NetworkConfig {
    const config = AppConfig.networks[scope];
    if (!config) {
      throw new NetworkServiceException(
        `Network not found for scope: ${scope}`,
      );
    }
    return config;
  }

  /**
   * Fetches the current base fee per operation from the Stellar network.
   *
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to the base fee as BigNumber.
   * @throws {NetworkServiceException} If the fee cannot be fetched.
   */
  async getBaseFee(scope: KnownCaip2ChainId): Promise<BigNumber> {
    try {
      const client = this.#getHorizonClient(scope);
      const baseFee = await client.fetchBaseFee();
      return multiplyFee(new BigNumber(baseFee), AppConfig.transaction.baseFeeMultiplier);
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: `Failed to get base fee for scope: ${scope}`,
      });
    }
  }

  /**
   * Fetches the current base fee per operation from the Stellar network with cache.
   *
   * @param scope - The CAIP-2 chain ID.
   * @param refreshCache - Whether to refresh the cache.
   * @returns A promise that resolves to the base fee as BigNumber.
   */
  async getBaseFeeWithCache(
    scope: KnownCaip2ChainId,
    refreshCache: boolean = false,
  ): Promise<BigNumber> {
    return useCache(this.getBaseFee.bind(this), this.#cache, {
      functionName: 'NetworkService:getBaseFeeWithCache',
      ttlMilliseconds: AppConfig.cache.ttlMilliseconds.baseFee,
      refreshCache,
    })(scope);
  }

  /**
   * Whether a transaction has been ingested by Horizon and its ledger outcome.
   *
   * @param transactionHash - Transaction hash from submission (hex).
   * @param scope - CAIP-2 chain id (Horizon endpoint).
   * @returns `pending` when the tx is not yet available (404); `success` / `failed` when present.
   * @throws {NetworkServiceException} When Horizon returns a non-404 error.
   */
  async getHorizonTransactionInclusionStatus(
    transactionHash: string,
    scope: KnownCaip2ChainId,
  ): Promise<'pending' | 'success' | 'failed'> {
    try {
      const client = this.#getHorizonClient(scope);
      const record = await client
        .transactions()
        .transaction(transactionHash)
        .call();
      return record.successful ? 'success' : 'failed';
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return 'pending';
      }
      return this.#throwError({
        error,
        fallbackError: 'Failed to load transaction from Horizon',
      });
    }
  }

  /**
   * Polls Soroban RPC until the transaction reaches a terminal status, then returns the hash on
   * success or throws.
   *
   * @param transactionHash - Hash returned from `sendTransaction`.
   * @param scope - The CAIP-2 chain ID.
   * @returns The transaction hash when {@link rpc.Api.GetTransactionStatus.SUCCESS}.
   * @throws {TransactionPollException} When the terminal status is not SUCCESS.
   * @throws {NetworkServiceException} When polling fails for another reason (e.g. RPC error).
   */
  async pollTransaction(
    transactionHash: string,
    scope: KnownCaip2ChainId,
  ): Promise<string> {
    try {
      const client = this.#getRpcClient(scope);
      const result = await client.pollTransaction(transactionHash, {
        attempts: AppConfig.transaction.pollingAttempts,
      });
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return result.txHash;
      }
      throw new TransactionPollException(transactionHash, result.status, scope);
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to poll transaction',
      });
    }
  }

  /**
   * Loads the account from **Horizon** (balances, trustlines, sequence, subentries, etc.).
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to a {@link OnChainAccount} backed by Horizon's account response.
   * @throws {AccountNotActivatedException} If the account does not exist on the network.
   * @throws {NetworkServiceException} If loading fails for another reason (e.g. network error).
   */
  async loadOnChainAccount(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount> {
    try {
      const client = this.#getHorizonClient(scope);
      return OnChainAccount.fromHorizon(
        await client.loadAccount(accountAddress),
        scope,
      );
    } catch (error: unknown) {
      if (isAccountNotFoundError(error, accountAddress)) {
        throw new AccountNotActivatedException(accountAddress, scope, {
          cause: error,
        });
      }
      return this.#throwError({
        error,
        fallbackError: 'Failed to load an account',
      });
    }
  }

  /**
   * Loads the account from **Horizon** (balances, trustlines, sequence, subentries, etc.) with cache.
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @param refreshCache - Whether to refresh the cache.
   * @returns A promise that resolves to a {@link OnChainAccount} backed by Horizon's account response.
   */
  async loadOnChainAccountWithCache(
    accountAddress: string,
    scope: KnownCaip2ChainId,
    refreshCache: boolean = false,
  ): Promise<OnChainAccount> {
    // small trade-off to convert the account to a serializable object.
    const serialized = await useCache(
      async (_accountAddress, _scope) => {
        const account = await this.loadOnChainAccount(accountAddress, scope);
        return account.toSerializableFull();
      },
      this.#cache,
      {
        functionName: 'NetworkService:loadOnChainAccount',
        ttlMilliseconds: AppConfig.cache.ttlMilliseconds.loadOnChainAccount,
        refreshCache,
      },
    )(accountAddress, scope);

    return OnChainAccount.fromSerializable(serialized);
  }

  /**
   * Loads the accounts from **Horizon** (balances, trustlines, sequence, subentries, etc.).
   *
   * @param accountAddresses - The Stellar account addresses (public keys).
   * @param scope - The CAIP-2 chain ID.
   * @param batchSize - The batch size for the accounts.
   * @returns A Promise that resolves to an array of {@link OnChainAccount} objects.
   * @throws {NetworkServiceException} When the batch request fails before per-account settlement.
   */
  async loadOnChainAccountsSafe(
    accountAddresses: string[],
    scope: KnownCaip2ChainId,
    // Hardcoded to 5 to avoid overwhelming the network
    batchSize: number = 5,
  ): Promise<(OnChainAccount | null)[]> {
    try {
      const settled = await batchesAllSettled(
        accountAddresses,
        batchSize,
        async (accountId) => this.loadOnChainAccount(accountId, scope), // Assume the onChainAccount scope is the same as the transaction scope
      );

      const onChainAccounts: (OnChainAccount | null)[] = [];
      let idx = 0;
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          onChainAccounts.push(result.value);
        } else {
          this.#logger.warn('Failed to preload participating account', {
            accountId: accountAddresses[idx],
            error: result.reason,
          });
          onChainAccounts.push(null);
        }
        idx += 1;
      }

      return onChainAccounts;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to load on-chain accounts',
      });
    }
  }

  /**
   * Fetches the account via Soroban RPC (`getAccountEntry`) and wraps it as {@link OnChainAccount}.
   * The underlying SDK `Account` has **id and sequence only** (no Horizon `balances`); use
   * {@link loadOnChainAccount} when you need full balance / trustline data.
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to a loaded account (sequence suitable for rebuilding txs).
   * @throws {AccountNotActivatedException} If Soroban RPC reports a missing account (SDK
   * `Error` message `Account not found: <G… address>`).
   * @throws {NetworkServiceException} If loading fails for another reason (e.g. network error).
   */
  async getAccount(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount> {
    try {
      const client = this.#getRpcClient(scope);
      const loaded = await client.getAccount(accountAddress);
      return new OnChainAccount(loaded, scope);
    } catch (error: unknown) {
      if (isAccountNotFoundError(error, accountAddress)) {
        throw new AccountNotActivatedException(accountAddress, scope, {
          cause: error,
        });
      }
      return this.#throwError({
        error,
        fallbackError: 'Failed to get account',
      });
    }
  }

  /**
   * Batch loads token contract ledger entries over Soroban RPC.
   *
   * @param assetIds - SEP-41 CAIP-19 asset ids (`…/sep41:C…`) for contracts on `scope`.
   * @param scope - The CAIP-2 chain ID.
   * @returns One {@link AssetDataResponse} per returned ledger entry, in RPC order. Ids with no matching
   * contract entry are omitted (this is not an error).
   * @throws {NetworkServiceException} When the RPC request fails.
   */
  async getSep41AssetsData(
    assetIds: KnownCaip19Sep41AssetId[],
    scope: KnownCaip2ChainId,
  ): Promise<AssetDataResponse[]> {
    try {
      const client = this.#getRpcClient(scope);

      // getLedgerEntries returns only entries that exist; missing contracts are omitted.
      const ledgerEntries = await client.getLedgerEntries(
        ...assetIds.map((assetId) =>
          new Contract(
            parseCaipAssetType(assetId).assetReference,
          ).getFootprint(),
        ),
      );

      return ledgerEntries.entries.map((ledgerEntry) => {
        const contractId = ledgerEntry.val.contractData().contract();
        const contractAddress = Address.fromScAddress(contractId).toString();

        const extractedAssetData = extractAssetDataFromContractData(
          ledgerEntry.val.contractData(),
          contractAddress,
        );

        if (extractedAssetData.isStellarClassicAsset) {
          const { assetCode, assetIssuer } = parseClassicAssetCodeIssuer(
            extractedAssetData.name,
          );
          return {
            // Normalize to use CAIP-19 classic asset id - ${CAIP_2_CHAIN_ID}/token:${ASSET_CODE}-${ASSET_ISSUER}
            assetId: toCaip19ClassicAssetId(scope, assetCode, assetIssuer),
            symbol: extractedAssetData.symbol,
            decimals: extractedAssetData.decimals,
            name: assetCode,
          };
        }

        return {
          // Normalize to use CAIP-19 SEP-41 asset id - ${CAIP_2_CHAIN_ID}/sep41:${CONTRACT_ADDRESS}
          assetId: toCaip19Sep41AssetId(scope, extractedAssetData.name),
          name: extractedAssetData.name,
          symbol: extractedAssetData.symbol,
          decimals: extractedAssetData.decimals,
        };
      });
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to get assets data from Soroban',
      });
    }
  }

  /**
   * Fetches classic asset data from Horizon via `assets` for a CAIP-19 classic asset id.
   *
   * @param assetId - CAIP-19 classic asset id (`…/asset:CODE-ISSUER`).
   * @param scope - The CAIP-2 chain ID.
   * @returns for the classic asset.
   * @throws {NetworkServiceException} When Horizon returns no entry for this asset or the request fails.
   */
  async getClassicAssetData(
    assetId: KnownCaip19ClassicAssetId,
    scope: KnownCaip2ChainId,
  ): Promise<AssetDataResponse> {
    try {
      const client = this.#getHorizonClient(scope);
      const { assetCode, assetIssuer } = parseClassicAssetCodeIssuer(
        parseCaipAssetType(assetId).assetReference,
      );
      const assetData = await client
        .assets()
        .forCode(assetCode)
        .forIssuer(assetIssuer)
        .call();

      if (
        !assetData ||
        assetData.records.length === 0 ||
        assetData.records[0] === undefined ||
        assetData.records[0].asset_code !== assetCode ||
        assetData.records[0].asset_issuer !== assetIssuer
      ) {
        throw new NetworkServiceException(
          `Failed to get assets data from Horizon for asset id: ${assetId}`,
        );
      }

      return {
        assetId,
        symbol: assetCode,
        decimals: STELLAR_DECIMAL_PLACES,
        name: assetCode,
      };
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to get assets data from Horizon',
      });
    }
  }

  /**
   * Fetches SEP-41 asset balances for multiple accounts via Soroban simulation of `balance(Address)`.
   *
   * **Mainnet only** — uses the Stellar MultiCall router (single simulation). On testnet this method
   * returns `{}` until batch SEP-41 reads are supported there.
   *
   * @param params - Balance query input.
   * @param params.accounts - Accounts holding the token (`G…`).
   * @param params.assetIds - CAIP-19 asset ids for SEP-41 tokens.
   * @param params.scope - CAIP-2 chain id.
   * @returns Per-account map of asset id to balance in smallest units, or `null` when a cell cannot be read.
   * @throws {NetworkServiceException} When the RPC request fails or the multicall result length is wrong.
   */
  async getSep41AssetBalances(params: {
    accounts: string[];
    assetIds: KnownCaip19Sep41AssetId[];
    scope: KnownCaip2ChainId;
  }): Promise<
    Record<string, Record<KnownCaip19Sep41AssetId, BigNumber | null>>
  > {
    const { accounts, assetIds, scope } = params;

    if (accounts.length === 0 || assetIds.length === 0) {
      return {};
    }

    // Multicall is not supported on testnet.
    if (scope === KnownCaip2ChainId.Testnet) {
      return {};
    }

    try {
      const multiCall = new MultiCall({
        rpcClient: this.#getRpcClient(scope),
        routerContract: StellarRouterContract.V1,
        // Caller for `exec` on the router; first funded user account is typical; else the shared sim account.
        simulationAccount: accounts[0] ?? SIMULATION_ACCOUNT,
      });

      const invocations: InvocationV1[] = [];
      for (const account of accounts) {
        for (const assetId of assetIds) {
          invocations.push(
            new InvocationV1({
              contract: parseCaipAssetType(assetId).assetReference,
              method: 'balance',
              args: [new Address(account).toScVal()],
              // Allow the batch simulation to continue when a cell fails (missing contract, etc.).
              canFail: true,
            }),
          );
        }
      }
      const totalRecords = accounts.length * assetIds.length;

      const simResults: unknown[] = await multiCall.simResult(invocations, {
        scope,
      });

      if (simResults.length !== totalRecords) {
        throw new NetworkServiceException(
          `Failed to load SEP-41 token balance - multicall result length: ${simResults.length} does not match the expected number of records: ${totalRecords}`,
        );
      }

      const result: Record<
        string,
        Record<KnownCaip19Sep41AssetId, BigNumber | null>
      > = {};
      let idx = 0;
      for (const account of accounts) {
        for (const assetId of assetIds) {
          const simResult = simResults[idx];
          result[account] ??= {};
          result[account][assetId] = sep41MulticallCellToBalance(simResult);
          idx += 1;
        }
      }
      return result;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to load SEP-41 token balance',
      });
    }
  }

  /**
   * Fetches SEP-41 asset balances for multiple accounts via Soroban simulation of `balance(Address)` with cache.
   *
   * @param params - Balance query input.
   * @param params.accounts - Accounts holding the token (`G…`).
   * @param params.assetIds - CAIP-19 asset ids for SEP-41 tokens.
   * @param params.scope - CAIP-2 chain id.
   * @returns Per-account map of asset id to balance in smallest units, or `null` when a cell cannot be read.
   */
  async getSep41AssetBalancesWithCache(params: {
    accounts: string[];
    assetIds: KnownCaip19Sep41AssetId[];
    scope: KnownCaip2ChainId;
  }): Promise<
    Record<string, Record<KnownCaip19Sep41AssetId, BigNumber | null>>
  > {
    return useCache(this.getSep41AssetBalances.bind(this), this.#cache, {
      functionName: 'NetworkService:getSep41AssetBalancesWithCache',
      ttlMilliseconds: AppConfig.cache.ttlMilliseconds.sep41AssetBalance,
    })(params);
  }

  /**
   * Submits a signed transaction to the network and optionally waits for a terminal status.
   * `scope` must match {@link Transaction.scope} on the envelope.
   *
   * @param params - The parameters for sending a transaction.
   * @param params.transaction - The signed transaction to submit.
   * @param params.scope - The CAIP-2 chain ID (must match the envelope).
   * @param params.pollTransaction - If true, poll until terminal status and return the hash only on SUCCESS.
   * @returns The transaction hash from submission, or after successful polling when `pollTransaction` is true.
   * @throws {TransactionRetryableException} When RPC indicates bad sequence (`txBadSeq`); caller may refresh sequence and retry.
   * @throws {TransactionSendException} When submission fails for other RPC error reasons.
   * @throws {TransactionPollException} When `pollTransaction` is true and the transaction does not end in SUCCESS.
   */
  async send({
    transaction,
    scope,
    pollTransaction = false,
  }: {
    transaction: Transaction;
    scope: KnownCaip2ChainId;
    pollTransaction?: boolean;
  }): Promise<string> {
    try {
      const client = this.#getRpcClient(scope);
      const executedTransaction = await client.sendTransaction(
        transaction.getRaw(),
      );

      if (executedTransaction.status === 'ERROR') {
        const errorCode = this.#getSendRpcErrorCodeSafe(executedTransaction);
        if (isSameStr(errorCode, KnownRpcError.TxBadSeq)) {
          throw new TransactionRetryableException(scope, errorCode);
        }
        throw new TransactionSendException(scope, errorCode);
      }

      if (pollTransaction) {
        return await this.pollTransaction(executedTransaction.hash, scope);
      }

      return executedTransaction.hash;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: new TransactionSendException(scope, 'unknown', {
          cause: error,
        }),
      });
    }
  }

  /**
   * Simulates a Soroban transaction via RPC and returns a new {@link Transaction} with updated fee
   * and footprint (assembled envelope).
   *
   * @param transaction - Exactly one `invokeHostFunction` operation.
   * @param scope - The CAIP-2 chain ID.
   * @returns Assembled transaction suitable for signing.
   * @throws {SimulationException} When the envelope is not a valid contract invoke transaction, RPC reports a simulation error, or an unexpected failure occurs.
   * @throws {InvalidInvokeContractStructureException} When the envelope is not a single `invokeHostFunction` operation.
   */
  async simulateTransaction(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): Promise<Transaction> {
    try {
      if (!transaction.hasInvokeHostFunction) {
        throw new SimulationException(
          'Transaction is not a valid contract invoke transaction',
        );
      }

      assertInvokeHostFunctionSoleOperation(transaction);

      const client = this.#getRpcClient(scope);
      const rawTransaction = transaction.getRaw();
      const simulateResponse = await client.simulateTransaction(rawTransaction);

      if (rpc.Api.isSimulationError(simulateResponse)) {
        throw new SimulationException(
          typeof simulateResponse.error === 'string'
            ? simulateResponse.error
            : JSON.stringify(simulateResponse.error),
        );
      }

      // Get the min resource fee from the simulation response.
      const resourceFee = new BigNumber(simulateResponse.minResourceFee);

      if (
        resourceFee.isNaN() ||
        !resourceFee.isFinite() ||
        resourceFee.isNegative()
      ) {
        throw new SimulationException('Invalid resource fee');
      }

      // Set the resource fee to the multiplied value.
      // simulateResponse.transactionData will be used to assemble the transaction.
      // @link https://github.com/stellar/stellar-sdk/blob/main/packages/stellar-base/src/rpc/transaction.ts
      simulateResponse.transactionData.setResourceFee(
        multiplyFee(resourceFee, AppConfig.transaction.simulationFeeMultiplier).toString(),
      );

      const simulatedTransaction = rpc.assembleTransaction(
        rawTransaction,
        simulateResponse,
      );

      return Transaction.fromRaw(simulatedTransaction.build());
    } catch (error: unknown) {
      return this.#throwError({
        error,
        exceptionClasses: [InvalidInvokeContractStructureException],
        fallbackError: new SimulationException(
          'Failed to simulate transaction',
          { cause: error },
        ),
      });
    }
  }

  /**
   * Simulates a SEP-41 transfer via RPC and returns an assembled {@link Transaction} with fee and footprint.
   *
   * Results are cached by `assetId`, `fromAccountId`, `toAccountId`, and `scope` so repeated simulations
   * for the same transfer context (e.g. different amounts during fee estimation) avoid extra RPC calls.
   * Pass `refreshCache: true` when simulating the transaction that will be signed and submitted.
   *
   * @param params - Simulation parameters.
   * @param params.transaction - SEP-41 transfer envelope with exactly one `invokeHostFunction` operation.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 SEP-41 asset ID.
   * @param params.fromAccountId - Sender account ID.
   * @param params.toAccountId - Recipient account ID.
   * @param params.refreshCache - When true, bypasses the cache and stores a fresh simulation result.
   * @returns A promise that resolves to an assembled {@link Transaction}.
   */
  async simulateSep41TransferWithCache({
    transaction,
    scope,
    assetId,
    fromAccountId,
    toAccountId,
    refreshCache = false,
  }: {
    transaction: Transaction;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19Sep41AssetId;
    fromAccountId: string;
    toAccountId: string;
    refreshCache?: boolean;
  }): Promise<Transaction> {
    const cachedXdr = await useCache(
      async () => {
        const simulatedTransaction = await this.simulateTransaction(
          transaction,
          scope,
        );
        return simulatedTransaction.getRaw().toXDR();
      },
      this.#cache,
      {
        functionName: 'NetworkService:simulateSep41TransferWithCache',
        ttlMilliseconds: AppConfig.cache.ttlMilliseconds.simulateTransaction,
        refreshCache,
        generateCacheKey: (functionName: string, _args: Serializable[]) => {
          // This cache is intended for preflight/fee estimation only. The returned XDR
          // may contain stale transaction fields such as amount or sequence number.
          // Final signing/submission must call this with refreshCache: true.
          return `${functionName}:${assetId}:${fromAccountId}:${toAccountId}:${scope}`;
        },
      },
    )();

    return Transaction.fromXdr({
      xdr: cachedXdr,
      scope,
    });
  }

  /**
   * Fetches a single transaction by hash from Horizon and maps it to the internal
   * {@link Transaction} model (including on-chain `fee_charged`).
   *
   * @param transactionHash - Stellar transaction hash (`hex`).
   * @param scope - CAIP-2 network scope used to choose the Horizon client and decode envelope XDR.
   * @returns The mapped {@link Transaction}.
   * @throws {TransactionNotFoundException} When Horizon reports the transaction is not found.
   * @throws {NetworkServiceException} When the transaction cannot be fetched or mapped for another reason.
   */
  async getTransaction(
    transactionHash: string,
    scope: KnownCaip2ChainId,
  ): Promise<Transaction> {
    try {
      const client = this.#getHorizonClient(scope);
      const result = await client
        .transactions()
        .transaction(transactionHash)
        .call();
      return this.#toTransaction(result, scope);
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        throw new TransactionNotFoundException(transactionHash, {
          cause: error,
        });
      }

      return this.#throwError({
        error,
        fallbackError: 'Failed to fetch transaction',
      });
    }
  }

  /**
   * Scans account transactions from Horizon with cursor-based pagination.
   *
   * The scan starts at `lastScanToken` and fetches up to `maxScan` pages. Each
   * {@link Transaction} includes the source Horizon record on {@link Transaction.rawData}
   * (including `paging_token`) so callers can choose which cursor to persist for the next run.
   *
   * When `includeSelfTransactionsOnly` is true, filtered rows are omitted from the result;
   * callers that need a scan cursor must derive it from returned transactions (or pass
   * `includeSelfTransactionsOnly: false` and filter locally). An empty result does not
   * expose a paging token — callers should retain their previous cursor in that case.
   *
   * @param params - Scan parameters.
   * @param params.accountAddress - Stellar account id (`G...`) to query.
   * @param params.lastScanToken - Horizon cursor token from the previous scan (or empty string for initial scan).
   * @param params.scope - CAIP-2 network scope.
   * @param params.order - Horizon sort order (`asc` for catch-up scans, `desc` for initial recent-first scans).
   * @param params.pageSize - Maximum records per page (`MAX_TRANSACTIONS_PAGE_SIZE` by default).
   * @param params.maxScan - Maximum page count to fetch in this call (`MAX_TRANSACTION_SCAN_PAGES` by default). Values below 1 still fetch one page. @see {@link MAX_TRANSACTION_SCAN_PAGES}
   * @param params.includeSelfTransactionsOnly - Whether to keep only records whose source account matches `accountAddress`.
   * @param params.includeFailed - Whether to include failed transactions. Defaults to true.
   * @returns Mapped transactions with optional Horizon metadata on each item.
   * @throws {NetworkServiceException} When Horizon fetch fails.
   */
  async getTransactions(params: {
    accountAddress: string;
    lastScanToken: string | null;
    scope: KnownCaip2ChainId;
    order?: 'asc' | 'desc';
    pageSize?: number;
    maxScan?: number;
    includeSelfTransactionsOnly?: boolean;
    includeFailed?: boolean;
  }): Promise<Transaction[]> {
    const {
      accountAddress,
      lastScanToken,
      scope,
      order = 'asc',
      pageSize = MAX_TRANSACTIONS_PAGE_SIZE,
      maxScan = MAX_TRANSACTION_SCAN_PAGES,
      includeSelfTransactionsOnly = true,
      includeFailed = true,
    } = params;

    // Clamp so callers cannot skip the initial Horizon request (e.g. maxScan: 0).
    let maxScanRemaining = Math.max(maxScan, 1);

    try {
      const client = this.#getHorizonClient(scope);

      const initialTransactionsResponse = await client
        .transactions()
        .forAccount(accountAddress)
        .order(order)
        .cursor(lastScanToken ?? '')
        .limit(pageSize)
        .includeFailed(includeFailed)
        .call();

      let transactions = this.#toTransactions(
        initialTransactionsResponse.records,
        scope,
        accountAddress,
        includeSelfTransactionsOnly,
      );

      maxScanRemaining -= 1;

      // When a page is full, Horizon likely has more records available.
      // Continue pagination (bounded by `maxScan`) and aggregate those pages.
      let currentResponse = initialTransactionsResponse;
      while (
        maxScanRemaining > 0 &&
        currentResponse.records.length === pageSize
      ) {
        currentResponse = await currentResponse.next();

        if (currentResponse.records.length === 0) {
          break;
        }

        transactions = transactions.concat(
          this.#toTransactions(
            currentResponse.records,
            scope,
            accountAddress,
            includeSelfTransactionsOnly,
          ),
        );

        maxScanRemaining -= 1;
      }

      return transactions;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to fetch transactions',
      });
    }
  }

  #toTransactions(
    transactions: StellarHorizon.ServerApi.TransactionRecord[],
    scope: KnownCaip2ChainId,
    accountAddress: string,
    includeSelfTransactionsOnly: boolean,
  ): Transaction[] {
    const result: Transaction[] = [];

    for (const transaction of transactions) {
      if (
        (includeSelfTransactionsOnly &&
          transaction.source_account === accountAddress) ||
        !includeSelfTransactionsOnly
      ) {
        result.push(this.#toTransaction(transaction, scope));
      }
    }

    return result;
  }

  #toTransaction(
    horizonTransaction: StellarHorizon.ServerApi.TransactionRecord,
    scope: KnownCaip2ChainId,
  ): Transaction {
    return Transaction.fromHorizon({
      horizonTransaction,
      scope,
    });
  }

  #getSendRpcErrorCodeSafe(rpcError: rpc.Api.SendTransactionResponse): string {
    try {
      return rpcError.errorResult?.result().switch().name ?? 'unknown';
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to parse send error code',
        error,
      );
      return 'unknown';
    }
  }

  #throwError({
    error,
    exceptionClasses,
    fallbackError,
  }: {
    error: unknown;
    exceptionClasses?: readonly AnyErrorConstructor[];
    fallbackError: string | NetworkServiceException;
  }): never {
    return rethrowIfInstanceElseThrow(
      error,
      [NetworkServiceException, ...(exceptionClasses ?? [])],
      fallbackError instanceof Error
        ? fallbackError
        : new NetworkServiceException(String(fallbackError), { cause: error }),
    );
  }
}
