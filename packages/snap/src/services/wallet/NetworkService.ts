import {
  Horizon as StellarHorizon,
  NotFoundError,
  rpc,
} from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { LoadedAccount } from './api';
import {
  AccountLoadException,
  AccountNotActivatedException,
  BaseFeeFetchException,
  TransactionPollException,
  TransactionSendException,
  NetworkServiceException,
} from './exceptions';
import type { Transaction } from './Transaction';
import type { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { createPrefixedLogger } from '../../utils';
import type { ILogger } from '../../utils';

/**
 * Service for Stellar network reads: fees, account data, and transaction submission.
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
    const config = AppConfig.networks[scope];
    if (!config) {
      throw new NetworkServiceException(
        `Network not found for scope: ${scope}`,
      );
    }
    let client = this.#horizonClientMap.get(scope);
    if (!client) {
      client = new StellarHorizon.Server(config.horizonUrl);
      this.#horizonClientMap.set(scope, client);
    }
    return client;
  }

  #getRpcClient(scope: KnownCaip2ChainId): rpc.Server {
    const config = AppConfig.networks[scope];
    if (!config) {
      throw new NetworkServiceException(
        `Network not found for scope: ${scope}`,
      );
    }
    let client = this.#rpcClientMap.get(scope);
    if (!client) {
      client = new rpc.Server(config.rpcUrl);
      this.#rpcClientMap.set(scope, client);
    }
    return client;
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
   * Polls the network until the transaction reaches a terminal status, then returns its hash or throws.
   *
   * @param transactionHash - The hash of the submitted transaction.
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to the transaction hash if the status is SUCCESS.
   * @throws {TransactionPollException} If status is not SUCCESS or polling fails.
   */
  async pollTransaction(
    transactionHash: string,
    scope: KnownCaip2ChainId,
  ): Promise<string> {
    try {
      const client = this.#getRpcClient(scope);
      const result = await client.pollTransaction(transactionHash);

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return result.txHash;
      }
      throw new TransactionPollException(transactionHash, result.status, scope);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to poll transaction', error);
      if (error instanceof TransactionPollException) {
        throw error;
      }
      throw new TransactionPollException(transactionHash, 'unknown', scope);
    }
  }

  /**
   * Loads account data (id and sequence) from the Stellar network.
   *
   * @param accountAddress - The Stellar account address (public key).
   * @param scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to the account object.
   * @throws {AccountNotActivatedException} If the account does not exist on the network.
   * @throws {AccountLoadException} If loading fails for another reason (e.g. network error).
   */
  async loadAccount(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<LoadedAccount> {
    try {
      const client = this.#getHorizonClient(scope);
      return await client.loadAccount(accountAddress);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to load account', error);
      if (error instanceof NotFoundError) {
        throw new AccountNotActivatedException(accountAddress, scope);
      }
      throw new AccountLoadException(accountAddress, scope);
    }
  }

  /**
   * Submits a signed transaction to the network and optionally waits for a terminal status.
   *
   * @param params - The parameters for sending a transaction.
   * @param params.transaction - The signed transaction.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.pollTransaction - If true, poll until terminal status and return the hash only on SUCCESS.
   * @returns A Promise that resolves to the transaction hash.
   * @throws {TransactionSendException} If submission fails.
   * @throws {TransactionPollException} If polling is requested and the transaction does not succeed.
   */
  async send({
    transaction,
    pollTransaction = false,
    scope,
  }: {
    transaction: Transaction;
    pollTransaction?: boolean;
    scope: KnownCaip2ChainId;
  }): Promise<string> {
    try {
      const client = this.#getRpcClient(scope);

      const executedTransaction = await client.sendTransaction(
        transaction.getRaw(),
      );

      if (pollTransaction) {
        return await this.pollTransaction(executedTransaction.hash, scope);
      }

      return executedTransaction.hash;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to send transaction', error);
      if (error instanceof TransactionPollException) {
        throw error;
      }
      throw new TransactionSendException(scope);
    }
  }
}
