import { parseCaipAssetType } from '@metamask/utils';
import {
  Account as StellarAccount,
  Address,
  BASE_FEE,
  Contract,
  Horizon as StellarHorizon,
  NotFoundError,
  rpc,
  scValToNative,
  TransactionBuilder as StellarSdkTransactionBuilder,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { AssetDataResponse } from './api';
import { KnownRpcError } from './api';
import {
  AccountLoadException,
  AccountNotActivatedException,
  AssetDataFetchException,
  BaseFeeFetchException,
  NetworkServiceException,
  SimulationException,
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
import {
  caip2ChainIdToNetwork,
  extractAssetDataFromContractData,
  isAccountNotFoundError,
  parseScValToNative,
  sep41MulticallCellToBalance,
} from './utils';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
} from '../../api';
import { KnownCaip2ChainId } from '../../api';
import type { NetworkConfig } from '../../config';
import { AppConfig } from '../../config';
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import type { ILogger } from '../../utils';
import {
  isSameStr,
  createPrefixedLogger,
  parseClassicAssetCodeIssuer,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  rethrowIfInstanceElseThrow,
} from '../../utils';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import { Transaction } from '../transaction/Transaction';

/**
 * Stellar network access through **Horizon** and **Soroban RPC**: base fee, account loading (full
 * Horizon account vs RPC sequence-only), contract token metadata (`getLedgerEntries`), SEP-41
 * balance simulation, Soroban simulation / fee computation, transaction submission, and optional
 * post-submit polling.
 */
export class NetworkService {
  readonly #logger: ILogger;

  readonly #horizonClientMap = new Map<
    KnownCaip2ChainId,
    StellarHorizon.Server
  >();

  readonly #rpcClientMap = new Map<KnownCaip2ChainId, rpc.Server>();

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[🌐 NetworkService]');
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
   * @throws {BaseFeeFetchException} If the fee cannot be fetched.
   */
  async getBaseFee(scope: KnownCaip2ChainId): Promise<BigNumber> {
    try {
      const client = this.#getHorizonClient(scope);
      const baseFee = await client.fetchBaseFee();
      return new BigNumber(baseFee);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to fetch base fee', error);
      throw new BaseFeeFetchException(scope);
    }
  }

  /**
   * Polls Soroban RPC until the transaction reaches a terminal status, then returns the hash on
   * success or throws.
   *
   * @param transactionHash - Hash returned from `sendTransaction`.
   * @param scope - The CAIP-2 chain ID.
   * @returns The transaction hash when {@link rpc.Api.GetTransactionStatus.SUCCESS}.
   * @throws {TransactionPollException} When the terminal status is not SUCCESS, or polling fails
   * (uses {@link AppConfig.transaction.pollingAttempts} as the attempt budget).
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
      this.#logger.logErrorWithDetails('Failed to poll transaction', error);
      return rethrowIfInstanceElseThrow(
        error,
        [TransactionPollException],
        new TransactionPollException(transactionHash, 'unknown', scope),
      );
    }
  }

  /**
   * Loads the account from **Horizon** (balances, trustlines, sequence, subentries, etc.).
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to a {@link OnChainAccount} backed by Horizon's account response.
   * @throws {AccountNotActivatedException} If the account does not exist on the network.
   * @throws {AccountLoadException} If loading fails for another reason (e.g. network error).
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
      this.#logger.logErrorWithDetails('Failed to load an account', error);
      if (error instanceof NotFoundError) {
        throw new AccountNotActivatedException(accountAddress, scope);
      }
      throw new AccountLoadException(accountAddress, scope);
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
   * @throws {AccountLoadException} If loading fails for another reason (e.g. network error).
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
      this.#logger.logErrorWithDetails('Failed to get an account', error);
      if (isAccountNotFoundError(error, accountAddress)) {
        throw new AccountNotActivatedException(accountAddress, scope);
      }

      throw new AccountLoadException(accountAddress, scope);
    }
  }

  /**
   * Fetches token metadata from Soroban via `getLedgerEntries` for a SEP-41 contract CAIP-19 id.
   *
   * @param assetId - SEP-41 CAIP-19 asset id (`…/sep41:C…`) for a token contract on `scope`.
   * @param scope - The CAIP-2 chain ID.
   * @returns Classic- or SEP-41-shaped {@link AssetDataResponse} (classic when the contract is a Stellar Asset Contract).
   * @throws {AssetDataFetchException} When RPC returns no entry for this asset.
   */
  async getAssetData(
    assetId: KnownCaip19Sep41AssetId,
    scope: KnownCaip2ChainId,
  ): Promise<AssetDataResponse> {
    const assetsData = await this.getAssetsData([assetId], scope);
    const assetData = assetsData.find((asset) => asset.assetId === assetId);
    if (!assetData) {
      throw new AssetDataFetchException(scope, assetId);
    }
    return assetData;
  }

  /**
   * Batch counterpart to {@link getAssetData}: loads token contract ledger entries over Soroban RPC.
   *
   * @param assetIds - SEP-41 CAIP-19 asset ids (`…/sep41:C…`) for contracts on `scope`.
   * @param scope - The CAIP-2 chain ID.
   * @returns One {@link AssetDataResponse} per returned ledger entry, in RPC order. Ids with no matching
   * contract entry are omitted (this is not an error).
   * @throws {NetworkServiceException} When the RPC request fails.
   */
  async getAssetsData(
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
      this.#logger.logErrorWithDetails('Failed to get assets data', error);
      throw new NetworkServiceException('Failed to get assets data');
    }
  }

  /**
   * Fetches classic asset data from Horizon via `assets` for a CAIP-19 classic asset id.
   *
   * @param assetId - CAIP-19 classic asset id (`…/asset:CODE-ISSUER`).
   * @param scope - The CAIP-2 chain ID.
   * @returns for the classic asset.
   * @throws {AssetDataFetchException} When Horizon returns no entry for this asset.
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
        throw new AssetDataFetchException(scope, assetId);
      }

      return {
        assetId,
        symbol: assetCode,
        decimals: STELLAR_DECIMAL_PLACES,
        name: assetCode,
      };
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to get assets data from Horizon',
        error,
      );
      return rethrowIfInstanceElseThrow(
        error,
        [AssetDataFetchException],
        new NetworkServiceException('Failed to get assets data from Horizon'),
      );
    }
  }

  /**
   * Reads a SEP-41-style token balance via Soroban simulation of `balance(Address)`.
   *
   * @param params - Balance query input.
   * @param params.accountAddress - Account holding the token (`G…`).
   * @param params.assetId - CAIP-19 asset id for SEP-41 token.
   * @param params.scope - CAIP-2 chain id.
   * @param params.sequenceNumber - Current sequence number of the account (for the ephemeral tx).
   * @returns Token balance in the contract's smallest units.
   * @throws {SimulationException} When Soroban simulation fails.
   * @throws {NetworkServiceException} When simulation returns no result or another unexpected error occurs.
   */
  async getSep41TokenBalance(params: {
    accountAddress: string;
    assetId: KnownCaip19Sep41AssetId;
    scope: KnownCaip2ChainId;
    sequenceNumber: string;
  }): Promise<BigNumber> {
    const { accountAddress, assetId, scope, sequenceNumber } = params;
    const { assetReference: tokenAddress } = parseCaipAssetType(assetId);
    try {
      const client = this.#getRpcClient(scope);
      const token = new Contract(tokenAddress);
      const op = token.call(
        'balance',
        Address.fromString(accountAddress).toScVal(),
      );

      const account = new StellarAccount(accountAddress, sequenceNumber);
      const rawTx = new StellarSdkTransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: caip2ChainIdToNetwork(scope),
      })
        .addOperation(op)
        .setTimeout(180)
        .build();

      // Using simulateTransaction to get the balance is more reliable than calling the balance function directly.
      const sim = await client.simulateTransaction(rawTx);

      if (rpc.Api.isSimulationError(sim)) {
        throw new SimulationException(
          typeof sim.error === 'string' ? sim.error : JSON.stringify(sim.error),
        );
      }

      const retval = sim.result?.retval;
      if (!retval) {
        throw new NetworkServiceException(
          'SEP-41 balance simulation returned no result',
        );
      }

      const native = scValToNative(retval);

      return parseScValToNative(native);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to load SEP-41 token balance',
        error,
      );
      return rethrowIfInstanceElseThrow(
        error,
        [NetworkServiceException],
        new NetworkServiceException('Failed to load SEP-41 token balance'),
      );
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
      this.#logger.logErrorWithDetails(
        'Failed to load SEP-41 token balance',
        error,
      );
      return rethrowIfInstanceElseThrow(
        error,
        [NetworkServiceException],
        new NetworkServiceException('Failed to load SEP-41 token balance'),
      );
    }
  }

  /**
   * Loads account data when the account exists and is funded; returns `null` if the account is not on-chain.
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns The loaded account, or `null` when {@link AccountNotActivatedException} would apply.
   * @throws {AccountLoadException} If loading fails for a reason other than a missing account.
   */
  async loadActivatedAccountOrNull(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount | null> {
    try {
      return await this.loadOnChainAccount(accountAddress, scope);
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Like {@link getAccount} but returns `null` if the account is not on-chain.
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to a loaded account or `null` when missing.
   * @throws {AccountLoadException} If the fetch fails for a reason other than a missing account.
   */
  async getAccountOrNull(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount | null> {
    try {
      return await this.getAccount(accountAddress, scope);
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return null;
      }
      throw error;
    }
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
        const errorCode = this.#getSendRpcErrorCode(executedTransaction);
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
      this.#logger.logErrorWithDetails('Failed to send transaction', error);
      return rethrowIfInstanceElseThrow(
        error,
        [NetworkServiceException],
        new TransactionSendException(scope, 'unknown'),
      );
    }
  }

  /**
   * Simulates a Soroban transaction via RPC and returns a new {@link Transaction} with updated fee
   * and footprint (assembled envelope).
   *
   * @param transaction - Exactly one `invokeHostFunction` operation.
   * @param scope - The CAIP-2 chain ID.
   * @returns Assembled transaction suitable for signing.
   * @throws {NetworkServiceException} When the envelope is not a single `invokeHostFunction` operation.
   * @throws {SimulationException} When the RPC reports a simulation error or an unexpected failure occurs.
   */
  async simulateTransaction(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): Promise<Transaction> {
    try {
      const client = this.#getRpcClient(scope);
      if (
        !transaction.hasInvokeHostFunction ||
        transaction.operationCount !== 1
      ) {
        throw new NetworkServiceException(
          'Transaction is not a valid invokeHostFunction transaction',
        );
      }
      const rawTransaction = transaction.getRaw();
      const simulateResponse = await client.simulateTransaction(rawTransaction);

      if (rpc.Api.isSimulationError(simulateResponse)) {
        throw new SimulationException(
          typeof simulateResponse.error === 'string'
            ? simulateResponse.error
            : JSON.stringify(simulateResponse.error),
        );
      }

      const simulatedTransaction = rpc.assembleTransaction(
        rawTransaction,
        simulateResponse,
      );
      return new Transaction(simulatedTransaction.build());
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to simulate transaction', error);
      return rethrowIfInstanceElseThrow(
        error,
        [NetworkServiceException],
        new SimulationException(
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }
  }

  #getSendRpcErrorCode(rpcError: rpc.Api.SendTransactionResponse): string {
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
}
