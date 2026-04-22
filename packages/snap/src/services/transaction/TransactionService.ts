import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import { TransactionStatus, TransactionType } from '@metamask/keyring-api';

import type { Transaction } from './Transaction';
import type { TransactionRepository } from './TransactionRepository';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { BASE_FEE_CACHE_TTL_MILLISECONDS } from '../../constants';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { Serializable } from '../../utils/serialization';
import type { StellarKeyringAccount } from '../account/api';
import type { ICache } from '../cache';
import { useCache } from '../cache';
import type { NetworkService } from '../network';

export class TransactionService {
  readonly #logger: ILogger;

  readonly #transactionRepository: TransactionRepository;

  readonly #networkService: NetworkService;

  readonly #cache: ICache<Serializable>;

  constructor({
    logger,
    transactionRepository,
    networkService,
    cache,
  }: {
    logger: ILogger;
    transactionRepository: TransactionRepository;
    networkService: NetworkService;
    cache: ICache<Serializable>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🧾 TransactionService]');
    this.#transactionRepository = transactionRepository;
    this.#networkService = networkService;
    this.#cache = cache;
  }

  /**
   * Gets the base fee for a transaction.
   *
   * @param scope - The CAIP-2 chain id.
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
   * Creates a pending send transaction.
   *
   * @param params - The parameters for the pending send transaction.
   * @param params.txId - Stable id for this activity row (e.g. client correlation id).
   * @param params.account - Keyring account that initiated the send (`from`).
   * @param params.scope - CAIP-2 chain for `chain` on the keyring transaction.
   * @param params.toAddress - Destination Stellar address (`G…`).
   * @param params.amount - Amount in the asset’s smallest units (string).
   * @param params.asset - Display / CAIP metadata for `from` and `to` asset rows.
   * @param params.asset.type - CAIP-19 (or slip44) asset id.
   * @param params.asset.symbol - Human-readable unit label (e.g. `XLM`).
   * @returns A promise that resolves to the pending send transaction.
   */
  async createPendingSendTransaction({
    txId,
    account,
    scope,
    toAddress,
    amount,
    asset,
  }: {
    txId: string;
    account: StellarKeyringAccount;
    scope: KnownCaip2ChainId;
    toAddress: string;
    amount: string;
    asset: {
      type: KnownCaip19AssetIdOrSlip44Id;
      symbol: string;
    };
  }): Promise<KeyringTransaction> {
    const timestamp = Math.floor(Date.now() / 1000);

    const transaction: KeyringTransaction = {
      type: TransactionType.Send,
      id: txId,
      from: [
        {
          address: account.address,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount,
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: toAddress,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount,
            fungible: true,
          },
        },
      ],
      events: [
        {
          status: TransactionStatus.Unconfirmed,
          timestamp,
        },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp,
      fees: [],
    };

    this.#logger.debug('Creating pending send transaction', {
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
    await this.#transactionRepository.save(transaction);
  }

  /**
   * Saves multiple transactions.
   *
   * @param transactions - The transactions to save.
   * @returns A promise that resolves when the transactions are saved.
   */
  async saveMany(transactions: KeyringTransaction[]): Promise<void> {
    await this.#transactionRepository.saveMany(transactions);
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
}
