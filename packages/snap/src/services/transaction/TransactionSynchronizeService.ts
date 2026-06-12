import {
  KeyringEvent,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { Mutex } from 'async-mutex';

import type {
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
  TransactionId,
} from '../../api';
import type { ILogger } from '../../utils';
import {
  batchesAllSettled,
  createPrefixedLogger,
  getSnapProvider,
  pushToRecordArray,
} from '../../utils';
import type { KeyringAccountId, StellarKeyringAccount } from '../account';
import { TransactionOrder } from './api';
import type { Transaction } from './Transaction';
import type { TransactionMapper } from './TransactionMapper';
import type { TransactionRepository } from './TransactionRepository';
import type {
  AssetMetadataService,
  StellarAssetMetadata,
} from '../asset-metadata';
import type { NetworkService } from '../network';
import { isPendingTransactionStatus } from './utils';
import type { ActivatedAccountPair } from '../sync/api';

/** Pending snap-state txs keyed by account, then by on-chain transaction hash. */
type PendingTransactionsByAccount = Map<
  KeyringAccountId,
  Map<TransactionId, KeyringTransaction>
>;

/**
 * Mutable state shared across fetch, map, and persist steps within one sync run.
 */
type SyncContext = {
  scope: KnownCaip2ChainId;
  keyringAccounts: StellarKeyringAccount[];
  keyringAccountsById: Map<KeyringAccountId, StellarKeyringAccount>;
  pendingByAccount: PendingTransactionsByAccount;
  lastScanTokenByAccountId: Record<KeyringAccountId, string | null>;
  /** Mapped keyring txs collected during steps 2–3; persisted and emitted in step 4. */
  transactionsToSave: Record<KeyringAccountId, KeyringTransaction[]>;
  sep41AssetsMetadata: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>;
};

/**
 * Reconciles Stellar transaction history for activated keyring accounts.
 *
 * Sync run:
 * 1. Create {@link SyncContext} — pending txs from snap state, scan cursors, empty collector.
 * 2. Scan paginated on-chain history per account and map to keyring transactions.
 * 3. Reconcile remaining snap pending txs against on-chain (by hash), then map.
 * 4. Save snap state and emit `AccountTransactionsUpdated` to the controller.
 *
 * Confirmed/failed history is stored in the controller, not snap state. First scan uses
 * DESC order (newest first, page-limited). Incremental scans use ASC from the saved cursor.
 */
export class TransactionSynchronizeService {
  readonly #transactionMapper: TransactionMapper;

  readonly #transactionRepository: TransactionRepository;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #networkService: NetworkService;

  readonly #logger: ILogger;

  /** Prevents overlapping sync runs from interleaving read–merge–write. */
  readonly #synchronizeMutex = new Mutex();

  constructor({
    networkService,
    transactionMapper,
    transactionRepository,
    assetMetadataService,
    logger,
  }: {
    networkService: NetworkService;
    transactionRepository: TransactionRepository;
    transactionMapper: TransactionMapper;
    assetMetadataService: AssetMetadataService;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#transactionRepository = transactionRepository;
    this.#transactionMapper = transactionMapper;
    this.#assetMetadataService = assetMetadataService;
    this.#logger = createPrefixedLogger(
      logger,
      '[💼 TransactionSynchronizeService]',
    );
  }

  async synchronize(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    if (activatedAccountPairs.length === 0) {
      this.#logger.debug('No accounts to synchronize');
      return;
    }

    const startTime = Date.now();
    this.#logger.debug(`Synchronize transactions started at ${startTime}`);

    await this.#synchronizeMutex
      .runExclusive(async () => {
        this.#logger.debug(
          `Synchronize transactions mutex acquired at ${Date.now()}`,
        );
        // Step 1: pending txs from snap state, scan cursors, and an empty mapped-tx queue.
        const context = await this.#createSyncContext(
          activatedAccountPairs,
          scope,
        );

        // Step 2: Fetch Horizon history per account → map to keyring transactions.
        await this.#scanAccountTransactionsAndMap(context);

        // Step 3: snap pending txs not seen in step 2 — fetch by hash, verify on chain, map.
        await this.#reconcilePendingTransactionsAndMap(context);

        // Step 4: update snap state (pending removal + scan cursors) and emit to controller.
        await this.#saveAndEmit(context);
      })
      .finally(() => {
        const endTime = Date.now();
        this.#logger.debug(
          `Synchronize transactions completed at ${endTime} in ${endTime - startTime}ms`,
        );
      });
  }

  async #createSyncContext(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
  ): Promise<SyncContext> {
    const keyringAccounts: StellarKeyringAccount[] = [];
    const keyringAccountIds: KeyringAccountId[] = [];
    const keyringAccountsById = new Map<
      KeyringAccountId,
      StellarKeyringAccount
    >();
    for (const { keyringAccount } of activatedAccountPairs) {
      keyringAccountIds.push(keyringAccount.id);
      keyringAccounts.push(keyringAccount);
      keyringAccountsById.set(keyringAccount.id, keyringAccount);
    }

    // Use Promise.all (not allSettled): if state cannot be loaded, sync cannot continue.
    const [pendingByAccount, lastScanTokenByAccountId, sep41AssetsMetadata] =
      await Promise.all([
        this.#loadPendingTransactionsFromState(keyringAccountIds, scope),
        this.#fetchLastScanTokens(keyringAccountIds, scope),
        this.#getPersistedSep41AssetsMetadata(scope),
      ]);

    return {
      scope,
      keyringAccounts,
      keyringAccountsById,
      pendingByAccount,
      lastScanTokenByAccountId,
      transactionsToSave: {},
      sep41AssetsMetadata,
    };
  }

  async #getPersistedSep41AssetsMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>> {
    const persistedAssets =
      await this.#assetMetadataService.fetchSep41AssetsOrSyncOnce(scope);
    return persistedAssets.reduce<
      Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>
    >((acc, asset) => {
      acc[asset.assetId as KnownCaip19Sep41AssetId] = asset;
      return acc;
    }, {});
  }

  async #fetchLastScanTokens(
    keyringAccountIds: KeyringAccountId[],
    scope: KnownCaip2ChainId,
  ): Promise<Record<KeyringAccountId, string | null>> {
    return this.#transactionRepository.findLastScanTokenByAccountIds(
      keyringAccountIds,
      scope,
    );
  }

  async #loadPendingTransactionsFromState(
    keyringAccountIds: KeyringAccountId[],
    scope: KnownCaip2ChainId,
  ): Promise<PendingTransactionsByAccount> {
    const transactions = await this.#transactionRepository.findByAccountIds(
      keyringAccountIds,
      scope,
    );

    const pendingByAccount: PendingTransactionsByAccount = new Map();

    // Transaction ids can be shared across accounts (send vs receive), so index by account first.
    for (const transaction of transactions) {
      if (isPendingTransactionStatus(transaction.status)) {
        this.#setPendingInState(pendingByAccount, transaction);
      }
    }

    this.#logger.debug('Pending transactions loaded from snap state', {
      noOfAccounts: keyringAccountIds.length,
      noOfStoredTransactions: transactions.length,
      noOfPendingTransactions:
        this.#getPendingTransactionCount(pendingByAccount),
    });

    return pendingByAccount;
  }

  async #scanAccountTransactionsAndMap(context: SyncContext): Promise<void> {
    // We use promise.allSettled here because we want to continue the sync even if some accounts fail to fetch.
    const fetchResults = await batchesAllSettled(
      context.keyringAccounts,
      10,
      async (keyringAccount) => {
        const lastScanToken =
          context.lastScanTokenByAccountId[keyringAccount.id] ?? null;

        return {
          keyringAccount,
          ...(await this.#fetchOnChainTransactionsAndNextScanToken({
            address: keyringAccount.address,
            lastScanToken,
            scope: context.scope,
          })),
        };
      },
    );

    for (const fetchResult of fetchResults) {
      if (fetchResult.status === 'rejected') {
        this.#logger.logErrorWithDetails(
          'Failed to fetch on-chain transactions',
          fetchResult.reason,
        );
        continue;
      }

      const { keyringAccount, transactions, nextScanToken } = fetchResult.value;
      let noOfResolved = 0;

      for (const transaction of transactions) {
        const pendingFromState = this.#getPendingFromState(
          context.pendingByAccount,
          keyringAccount.id,
          transaction.id,
        );

        // Pending tx seen in this scan — skip the reconcile pass below.
        if (pendingFromState) {
          this.#deletePendingFromState(
            context.pendingByAccount,
            keyringAccount.id,
            transaction.id,
          );
          noOfResolved += 1;
        }

        await this.#appendMappedTransaction(context, {
          keyringAccount,
          onChainTransaction: transaction,
          pendingFromState,
        });
      }

      this.#logger.debug('On-chain transactions mapped for account in scan', {
        accountId: keyringAccount.id,
        noOfPendingResolved: noOfResolved,
        noOfOnChainTransactions: transactions.length,
      });

      context.lastScanTokenByAccountId = {
        ...context.lastScanTokenByAccountId,
        [keyringAccount.id]: nextScanToken,
      };
    }
  }

  async #reconcilePendingTransactionsAndMap(
    context: SyncContext,
  ): Promise<void> {
    const pendingCountBeforeReconcile = this.#getPendingTransactionCount(
      context.pendingByAccount,
    );

    if (pendingCountBeforeReconcile === 0) {
      return;
    }

    const pendingByTransactionId: Record<TransactionId, KeyringTransaction[]> =
      {};

    // Group by transaction id so each on-chain hash is fetched once when shared across accounts.
    for (const pendingById of context.pendingByAccount.values()) {
      for (const pendingFromState of pendingById.values()) {
        pushToRecordArray(
          pendingByTransactionId,
          pendingFromState.id,
          pendingFromState,
        );
      }
    }

    const transactionIdsToFetch = Object.keys(pendingByTransactionId);

    this.#logger.debug('Reconciling pending transactions', {
      transactionIdsToFetch,
    });

    const fetchResults = await batchesAllSettled(
      transactionIdsToFetch,
      10,
      async (transactionId) => ({
        transactionId,
        onChainTransaction: await this.#fetchOnChainTransaction(
          transactionId,
          context.scope,
        ),
      }),
    );

    for (const fetchResult of fetchResults) {
      if (fetchResult.status === 'rejected') {
        this.#logger.logErrorWithDetails(
          'Failed to fetch on-chain transaction',
          fetchResult.reason,
        );
        continue;
      }

      const { transactionId, onChainTransaction } = fetchResult.value;

      // Map the on-chain transaction for every account that still has it pending.
      for (const pendingFromState of pendingByTransactionId[transactionId] ??
        []) {
        const keyringAccount = context.keyringAccountsById.get(
          pendingFromState.account,
        );

        if (!keyringAccount) {
          this.#logger.logErrorWithDetails(
            'Failed to find keyring account for pending transaction',
            { transactionId, accountId: pendingFromState.account },
          );
          continue;
        }

        await this.#appendMappedTransaction(context, {
          keyringAccount,
          onChainTransaction,
          pendingFromState,
        });

        this.#deletePendingFromState(
          context.pendingByAccount,
          pendingFromState.account,
          transactionId,
        );
      }
    }

    const remainingPendingCount = this.#getPendingTransactionCount(
      context.pendingByAccount,
    );

    this.#logger.debug('Pending transactions reconciled', {
      noOfResolved: pendingCountBeforeReconcile - remainingPendingCount,
      noOfRemaining: remainingPendingCount,
    });
  }

  async #appendMappedTransaction(
    context: SyncContext,
    params: {
      keyringAccount: StellarKeyringAccount;
      onChainTransaction: Transaction;
      pendingFromState?: KeyringTransaction;
    },
  ): Promise<void> {
    const { keyringAccount, onChainTransaction, pendingFromState } = params;

    const mappedTransaction = this.#transactionMapper.mapTransactionSafe({
      transaction: onChainTransaction,
      keyringAccount,
      transactionFromState: pendingFromState,
      assetMetadata: context.sep41AssetsMetadata,
    });

    // Unmappable transactions (e.g. dust spam) are omitted from activity history.
    if (mappedTransaction) {
      pushToRecordArray(
        context.transactionsToSave,
        keyringAccount.id,
        mappedTransaction,
      );
    }
  }

  async #fetchOnChainTransactionsAndNextScanToken(params: {
    address: string;
    lastScanToken: string | null;
    scope: KnownCaip2ChainId;
  }): Promise<{
    transactions: Transaction[];
    nextScanToken: string | null;
  }> {
    const { address, lastScanToken, scope } = params;

    // Fresh sync: newest-first for fast UX. Incremental sync: ASC from saved cursor.
    const order = lastScanToken ? TransactionOrder.ASC : TransactionOrder.DESC;

    this.#logger.debug('Fetching on-chain transactions', {
      address,
      lastScanToken,
      scope,
      order,
    });

    const transactions = await this.#networkService.getTransactions({
      accountAddress: address,
      lastScanToken,
      scope,
      order,
      includeSelfTransactionsOnly: false,
      includeFailed: true,
    });

    const nextScanToken =
      this.#getNextScanToken(transactions, order) ?? lastScanToken;

    return {
      transactions,
      nextScanToken,
    };
  }

  async #fetchOnChainTransaction(
    transactionId: TransactionId,
    scope: KnownCaip2ChainId,
  ): Promise<Transaction> {
    return this.#networkService.getTransaction(transactionId, scope);
  }

  #getNextScanToken(
    transactions: Transaction[],
    order: TransactionOrder,
  ): string | null {
    if (transactions.length === 0) {
      return null;
    }

    const cursorIndex = order === TransactionOrder.DESC ? 0 : -1;
    return transactions.at(cursorIndex)?.rawData?.paging_token ?? null;
  }

  async #saveAndEmit(context: SyncContext): Promise<void> {
    // Do emit event first to ensure the controller is updated with the latest transactions.
    // then save the transactions.
    // - if the emit fails, the transactions will not be saved and we can retry the sync from the last scan token later.
    // - if the save fails, worst case is to retry the sync from the last scan token later.
    await this.#emitTransactionsUpdated(context);
    await this.#saveTransactions(context);
  }

  async #saveTransactions(context: SyncContext): Promise<void> {
    this.#logger.debug('Saving transactions');
    const transactions = Object.values(context.transactionsToSave).flat();

    const lastScanTokensByAccountIdWithScope: Record<
      KeyringAccountId,
      Record<KnownCaip2ChainId, string | null>
    > = {};

    for (const [accountId, lastScanToken] of Object.entries(
      context.lastScanTokenByAccountId,
    )) {
      lastScanTokensByAccountIdWithScope[accountId] = {
        [context.scope]: lastScanToken ?? null,
      } as Record<KnownCaip2ChainId, string | null>;
    }

    await this.#transactionRepository.saveMany(
      transactions,
      lastScanTokensByAccountIdWithScope,
    );
    this.#logger.debug('Transactions saved');
  }

  async #emitTransactionsUpdated(context: SyncContext): Promise<void> {
    this.#logger.debug('Emitting transactions updated event', {
      noOfTransactions: Object.values(context.transactionsToSave).flat().length,
    });
    await emitSnapKeyringEvent(
      getSnapProvider(),
      KeyringEvent.AccountTransactionsUpdated,
      {
        transactions: context.transactionsToSave,
      },
    );
    this.#logger.debug('Transactions updated event emitted');
  }

  #getPendingTransactionCount(
    pendingByAccount: PendingTransactionsByAccount,
  ): number {
    let count = 0;
    for (const pendingById of pendingByAccount.values()) {
      count += pendingById.size;
    }
    return count;
  }

  #getPendingFromState(
    pendingByAccount: PendingTransactionsByAccount,
    accountId: KeyringAccountId,
    transactionId: TransactionId,
  ): KeyringTransaction | undefined {
    return pendingByAccount.get(accountId)?.get(transactionId);
  }

  #deletePendingFromState(
    pendingByAccount: PendingTransactionsByAccount,
    accountId: KeyringAccountId,
    transactionId: TransactionId,
  ): void {
    const pendingById = pendingByAccount.get(accountId);
    if (!pendingById) {
      return;
    }

    pendingById.delete(transactionId);

    if (pendingById.size === 0) {
      pendingByAccount.delete(accountId);
    }
  }

  #setPendingInState(
    pendingByAccount: PendingTransactionsByAccount,
    transaction: KeyringTransaction,
  ): void {
    let pendingById = pendingByAccount.get(transaction.account);
    if (!pendingById) {
      pendingById = new Map();
      pendingByAccount.set(transaction.account, pendingById);
    }

    pendingById.set(transaction.id, transaction);
  }
}
