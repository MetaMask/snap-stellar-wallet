import {
  KeyringEvent,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { groupBy } from 'lodash';

import type { Transaction } from './Transaction';
import type { TransactionBuilder } from './TransactionBuilder';
import type { TransactionRepository } from './TransactionRepository';
import type { KnownCaip19ClassicAssetId, KnownCaip2ChainId } from '../../api';
import { BASE_FEE_CACHE_TTL_MILLISECONDS } from '../../constants';
import type { Serializable } from '../../utils';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { StellarKeyringAccount } from '../account/api';
import type { NetworkService } from '../network';
import { TransactionRetryableException } from '../network/exceptions';
import type { OnChainAccount } from '../on-chain-account/OnChainAccount';
import type { Wallet } from '../wallet';
import {
  SupportedOperations,
  TransactionSimulator,
  type TransactionSimulatorOptions,
} from './TransactionSimulator';
import { assertTransactionScope } from './utils';
import type { ICache } from '../cache';
import { useCache } from '../cache';
import type { KeyringTransactionRequest } from './KeyringTransactionBuilder';
import { KeyringTransactionBuilder } from './KeyringTransactionBuilder';

export class TransactionService {
  readonly #logger: ILogger;

  readonly #transactionRepository: TransactionRepository;

  readonly #networkService: NetworkService;

  readonly #transactionBuilder: TransactionBuilder;

  readonly #keyringTransactionBuilder: KeyringTransactionBuilder;

  readonly #cache: ICache<Serializable>;

  constructor({
    logger,
    transactionRepository,
    networkService,
    transactionBuilder,
    cache,
  }: {
    logger: ILogger;
    transactionRepository: TransactionRepository;
    networkService: NetworkService;
    transactionBuilder: TransactionBuilder;
    cache: ICache<Serializable>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🧾 TransactionService]');
    this.#transactionRepository = transactionRepository;
    this.#networkService = networkService;
    this.#transactionBuilder = transactionBuilder;
    this.#keyringTransactionBuilder = new KeyringTransactionBuilder();
    this.#cache = cache;
  }

  /**
   * Gets the base fee for a transaction.
   * Results are cached for {@link BASE_FEE_CACHE_TTL_MILLISECONDS}.
   *
   * @param scope - The CAIP-2 chain ID.
   * @returns A promise that resolves to the base fee.
   */
  async getBaseFee(scope: KnownCaip2ChainId): Promise<BigNumber> {
    return useCache(
      this.#networkService.getBaseFee.bind(this.#networkService),
      this.#cache,
      {
        functionName: 'TransactionService:getBaseFee',
        ttlMilliseconds: BASE_FEE_CACHE_TTL_MILLISECONDS,
      },
    )(scope);
  }

  /**
   * Creates a validated change trust transaction.
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 classic asset ID.
   * @param params.limit - The limit for the trustline, 0 for delete trustline.
   *
   * @returns A promise that resolves to the validated transaction.
   */
  async createValidatedChangeTrustTransaction(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19ClassicAssetId;
    limit?: string;
  }): Promise<Transaction> {
    const { onChainAccount, scope, assetId, limit } = params;

    const baseFee = await this.getBaseFee(scope);

    const transaction = this.#transactionBuilder.changeTrust({
      onChainAccount,
      assetId,
      scope,
      baseFee: baseFee.toString(),
      limit,
    });

    this.validateTransaction(transaction, onChainAccount, {
      expectedOPTypes: [SupportedOperations.ChangeTrust],
    });

    return transaction;
  }

  /**
   * Create and save a pending keyring transaction.
   *
   * @param request - The request {@link KeyringTransactionRequest} to create the pending transaction for.
   * @returns A promise that resolves to the pending transaction.
   */
  async savePendingKeyringTransaction(
    request: KeyringTransactionRequest,
  ): Promise<KeyringTransaction> {
    const transaction =
      this.#keyringTransactionBuilder.createTransaction(request);

    this.#logger.debug('Creating pending transaction', {
      transaction,
    });

    await this.save(transaction);

    return transaction;
  }

  /**
   * Computes the fee for a transaction.
   *
   * @param transaction - The transaction to compute the fee for.
   * @returns A promise that resolves to the transaction with the computed fee.
   */
  async computingFee(transaction: Transaction): Promise<Transaction> {
    if (transaction.hasInvokeHostFunction) {
      const simulatedTransaction =
        await this.#networkService.simulateTransaction(
          transaction,
          transaction.scope,
        );
      return simulatedTransaction;
    }
    return transaction;
  }

  /**
   * Runs local fee/balance/operation simulation for a transaction against the given ledger snapshot.
   * Delegates to {@link TransactionSimulator.simulate}; throws the same validation exceptions.
   *
   * @param transaction - The transaction to validate.
   * @param onChainAccount - The on-chain account to validate against.
   * @param options - Optional options for the transaction validation {@link TransactionSimulatorOptions}.
   * @throws {TransactionScopeNotMatchException} When {@link OnChainAccount.scope} does not match {@link Transaction.scope}.
   * @throws {TransactionValidationException} When the transaction cannot be validated.
   */
  validateTransaction(
    transaction: Transaction,
    onChainAccount: OnChainAccount,
    options?: TransactionSimulatorOptions,
  ): void {
    const simulator = new TransactionSimulator();
    simulator.simulate(transaction, onChainAccount, options);
  }

  /**
   * Submits a signed transaction.
   * When the transaction fails with `txBadSeq`, reloads the account sequence, rebuilds, re-signs once, and retries
   * **only when** the transaction source matches the resolved {@link OnChainAccount}'s `accountId` (this account consumes sequence).
   * If the source is another account, `txBadSeq` is rethrown: sequence must be fixed on their side and the envelope re-signed.
   *
   * @param params - Options object.
   * @param params.wallet - Wallet used to sign; for automatic retry, must be the transaction source account.
   * @param params.onChainAccount - On-chain account for the signing account (sequence bump on `txBadSeq` retry).
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.transaction - The signed transaction (same envelope used as the rebuild template on retry).
   * @param params.pollTransaction - If true, wait for RPC terminal status after submit.
   * @returns A promise that resolves to the transaction hash.
   * @throws {TransactionScopeNotMatchException} When `scope` does not match {@link Transaction.scope} (from {@link assertTransactionScope} before submit).
   * @throws {TransactionRetryableException} When RPC returns `txBadSeq` for the signing account (one rebuild+retry is attempted when the tx source matches `onChainAccount`).
   * @throws {TransactionSendException} When submission fails for other RPC reasons.
   * @throws {TransactionPollException} When `pollTransaction` is true and polling does not end in SUCCESS.
   */
  async sendTransaction(params: {
    wallet: Wallet;
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    transaction: Transaction;
    pollTransaction?: boolean;
  }): Promise<string> {
    const {
      wallet,
      onChainAccount,
      scope,
      transaction: templateTransaction,
    } = params;

    assertTransactionScope(templateTransaction, scope);

    const pollTransaction = params.pollTransaction ?? false;

    const sendOnce = async (transaction: Transaction): Promise<string> =>
      this.#networkService.send({
        transaction,
        scope,
        pollTransaction,
      });

    try {
      return await sendOnce(templateTransaction);
    } catch (error: unknown) {
      if (error instanceof TransactionRetryableException) {
        const txSource = templateTransaction.sourceAccount;
        if (txSource !== onChainAccount.accountId) {
          this.#logger.warn(
            'transaction failed with txBadSeq but transaction source does not match wallet; cannot bump sequence.',
          );
          throw error;
        }

        const freshAccount = await this.#networkService.getAccount(
          onChainAccount.accountId,
          scope,
        );

        const newTransaction = this.#transactionBuilder.rebuildTxnWithNewSeq({
          transaction: templateTransaction,
          sequenceNumber: freshAccount.sequenceNumber,
        });

        wallet.signTransaction(newTransaction);

        return await sendOnce(newTransaction);
      }
      throw error;
    }
  }

  /**
   * Finds all transactions for the given accounts.
   *
   * @param accounts - The accounts to find transactions for.
   * @returns A promise that resolves to an array of transactions.
   */
  async findByAccounts(
    accounts: StellarKeyringAccount[],
  ): Promise<KeyringTransaction[]> {
    const transactions = await Promise.all(
      accounts.map(async (account) =>
        this.#transactionRepository.findByAccountId(account.id),
      ),
    );

    return transactions.flat();
  }

  /**
   * Saves a transaction.
   *
   * @param transaction - The transaction to save.
   * @returns A promise that resolves when the transaction is saved.
   */
  async save(transaction: KeyringTransaction): Promise<void> {
    // use saveMany here to leverage the state lock,
    // hence the update of the state and the transaction event emission will be in sequence
    await this.saveMany([transaction]);
  }

  /**
   * Saves multiple transactions.
   *
   * @param transactions - The transactions to save.
   * @returns A promise that resolves when the transactions are saved.
   */
  async saveMany(transactions: KeyringTransaction[]): Promise<void> {
    await this.#transactionRepository.saveMany(transactions);
    await this.#emitAccountTransactionsUpdated(transactions);
  }

  /**
   * Pulls transaction history from the network and reconciles local snap state.
   * Not implemented yet; safe to call from {@link SynchronizeService.synchronize}.
   *
   * @param _accounts - Keyring accounts whose history will be synced (unused until implemented).
   * @param _scope - Network scope for fetches (unused until implemented).
   */
  async synchronize(
    _accounts: StellarKeyringAccount[],
    _scope: KnownCaip2ChainId,
  ): Promise<void> {
    this.#logger.debug(
      'TransactionService.synchronize: transaction history sync not implemented yet',
    );
  }

  async #emitAccountTransactionsUpdated(
    transactions: KeyringTransaction[],
  ): Promise<void> {
    const transactionsByAccountId = groupBy(transactions, 'account');

    await emitSnapKeyringEvent(snap, KeyringEvent.AccountTransactionsUpdated, {
      transactions: transactionsByAccountId,
    });
  }
}
