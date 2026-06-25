import {
  KeyringEvent,
  FungibleAssetStruct,
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { Mutex } from 'async-mutex';
import { cloneDeep } from 'lodash';

import type {
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
  StellarAddress,
  TransactionId,
} from '../../api';
import type { ILogger } from '../../utils';
import {
  batchesAllSettled,
  createPrefixedLogger,
  getSnapProvider,
  isSameStr,
  isSep41Id,
  pushToRecordArray,
} from '../../utils';
import type {
  AccountService,
  KeyringAccountId,
  StellarKeyringAccount,
} from '../account';
import type { StellarKeyringTransaction } from './api';
import { TransactionOrder } from './api';
import type { Transaction } from './Transaction';
import type { TransactionMapper } from './TransactionMapper';
import type { TransactionRepository } from './TransactionRepository';
import type { StellarAssetMetadata } from '../asset-metadata';
import { TransactionNotFoundException, type NetworkService } from '../network';
import {
  isPendingTransactionStatus,
  shouldDropPendingTransaction,
  toKeyringTransactions,
} from './utils';
import type { ActivatedAccountPair } from '../sync/api';

/**
 * Mutable state shared across fetch, map, and persist steps within one sync run.
 */
type SyncContext = {
  scope: KnownCaip2ChainId;
  keyringAccounts: StellarKeyringAccount[];
  keyringAccountsById: Map<KeyringAccountId, StellarKeyringAccount>;
  /** All snap-managed accounts on `scope`, keyed by address for SEP-41 receive mapping. */
  allAccountsByAddress: Map<StellarAddress, StellarKeyringAccount>;
  pendingTransactionsById: Map<TransactionId, StellarKeyringTransaction>;
  lastScanTokenByAccountId: Record<KeyringAccountId, string | null>;
  /** Mapped keyring txs collected during steps 2–3; persisted and emitted in step 4. */
  transactionsToSave: Record<KeyringAccountId, StellarKeyringTransaction[]>;
  sep41AssetsMetadata: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>;
};

/**
 * Reconciles Stellar transaction history for activated keyring accounts.
 *
 * Sync run:
 * 1. Create {@link SyncContext} — pending txs from snap state, scan cursors, empty collector.
 * 2. Scan paginated on-chain history per account, map to keyring transactions, and apply best-effort SEP-41 receive mapping.
 * 3. Reconcile remaining snap pending txs against on-chain (by hash), then map.
 * 4. Save snap state and emit `AccountTransactionsUpdated` to the controller.
 *
 * Confirmed/failed history is stored in the controller, not snap state. First scan uses
 * DESC order (newest first, page-limited). Incremental scans use ASC from the saved cursor.
 */
export class TransactionSynchronizeService {
  readonly #transactionMapper: TransactionMapper;

  readonly #transactionRepository: TransactionRepository;

  readonly #networkService: NetworkService;

  readonly #accountService: AccountService;

  readonly #logger: ILogger;

  /** Prevents overlapping sync runs from interleaving read–merge–write. */
  readonly #synchronizeMutex = new Mutex();

  constructor({
    networkService,
    transactionMapper,
    transactionRepository,
    accountService,
    logger,
  }: {
    networkService: NetworkService;
    transactionRepository: TransactionRepository;
    transactionMapper: TransactionMapper;
    accountService: AccountService;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#transactionRepository = transactionRepository;
    this.#transactionMapper = transactionMapper;
    this.#accountService = accountService;
    this.#logger = createPrefixedLogger(
      logger,
      '[💼 TransactionSynchronizeService]',
    );
  }

  async synchronize(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
    sep41Assets: StellarAssetMetadata[],
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
          sep41Assets,
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

  // #region -------------------- Context Creation --------------------
  async #createSyncContext(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
    sep41Assets: StellarAssetMetadata[],
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
    const [
      pendingTransactionsById,
      lastScanTokenByAccountId,
      allAccountsByAddress,
    ] = await Promise.all([
      this.#loadPendingTransactionsFromState(keyringAccountIds, scope),
      this.#fetchLastScanTokens(keyringAccountIds, scope),
      this.#loadAllAccountsByAddress(scope),
    ]);
    const sep41AssetsMetadata = this.#toSep41AssetsMetadata(sep41Assets);

    return {
      scope,
      keyringAccounts,
      keyringAccountsById,
      allAccountsByAddress,
      pendingTransactionsById,
      lastScanTokenByAccountId,
      transactionsToSave: {},
      sep41AssetsMetadata,
    };
  }

  async #loadAllAccountsByAddress(
    scope: KnownCaip2ChainId,
  ): Promise<Map<StellarAddress, StellarKeyringAccount>> {
    const accounts = await this.#accountService.listAccountsByScope(scope);
    const allAccountsByAddress = new Map<
      StellarAddress,
      StellarKeyringAccount
    >();

    // Lowercase keys so recipient lookup matches regardless of StrKey casing.
    for (const account of accounts) {
      allAccountsByAddress.set(account.address.toLowerCase(), account);
    }

    return allAccountsByAddress;
  }

  #toSep41AssetsMetadata(
    sep41Assets: StellarAssetMetadata[],
  ): Record<KnownCaip19Sep41AssetId, StellarAssetMetadata> {
    return sep41Assets.reduce<
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
  ): Promise<Map<TransactionId, StellarKeyringTransaction>> {
    const transactions =
      await this.#transactionRepository.findStellarTransactionsByAccountIds(
        keyringAccountIds,
        scope,
      );

    const pendingTransactionsById: Map<
      TransactionId,
      StellarKeyringTransaction
    > = new Map();

    // Pending txs are unique and belong to the submitting account only.
    // Hence we don't need to group by account ID..
    for (const transaction of transactions) {
      if (isPendingTransactionStatus(transaction.status)) {
        pendingTransactionsById.set(transaction.id, transaction);
      }
    }

    this.#logger.debug('Pending transactions loaded from snap state', {
      noOfAccounts: keyringAccountIds.length,
      noOfStoredTransactions: transactions.length,
      noOfPendingTransactions: pendingTransactionsById.size,
    });

    return pendingTransactionsById;
  }
  // #endregion

  // #region -------------------- Main Step to scan transactions --------------------
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
        const pendingTransaction = context.pendingTransactionsById.get(
          transaction.id,
        );
        const pendingForAccount =
          pendingTransaction?.account === keyringAccount.id
            ? pendingTransaction
            : undefined;

        if (pendingForAccount) {
          context.pendingTransactionsById.delete(transaction.id);
          noOfResolved += 1;
        }

        this.#appendMappedTransaction(context, {
          keyringAccount,
          onChainTransaction: transaction,
          pendingTransaction: pendingForAccount,
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
    const pendingCountBeforeReconcile = context.pendingTransactionsById.size;

    if (pendingCountBeforeReconcile === 0) {
      return;
    }

    const transactionIdsToFetch = Array.from(
      context.pendingTransactionsById.keys(),
    );

    this.#logger.debug('Reconciling pending transactions', {
      transactionIdsToFetch,
    });

    const fetchResults = await batchesAllSettled(
      transactionIdsToFetch,
      10,
      async (transactionId) =>
        this.#fetchOnChainTransaction(transactionId, context.scope),
    );

    for (const fetchResult of fetchResults) {
      if (fetchResult.status === 'rejected') {
        const error = fetchResult.reason;
        // if the error is a TransactionNotFoundException,
        // increment the reconcile attempt and continue.
        if (error instanceof TransactionNotFoundException) {
          this.#incrementReconcileAttempt(context, error.transactionHash);
          continue;
        }
        // for other errors, log and continue.
        this.#logger.warn('Failed to fetch on-chain transaction', {
          error: fetchResult.reason,
        });
        continue;
      }

      const onChainTransaction = fetchResult.value;

      // Get the pending transaction from the sync context.
      // OnChain Transaction Id should be the same as the Pending Transaction Id.
      const pendingTransaction = context.pendingTransactionsById.get(
        onChainTransaction.id,
      );
      if (!pendingTransaction) {
        this.#logger.warn('Pending transaction not found after fetch', {
          transactionId: onChainTransaction.id,
        });
        continue;
      }

      // Find the keyring account that the pending transaction belongs to.
      // The pending transaction should only belong to one single account.
      const keyringAccount = context.keyringAccountsById.get(
        pendingTransaction.account,
      );
      if (!keyringAccount) {
        this.#logger.warn(
          'Failed to find keyring account for pending transaction',
          {
            transactionId: pendingTransaction.id,
            accountId: pendingTransaction.account,
          },
        );
        continue;
      }

      this.#appendMappedTransaction(context, {
        keyringAccount,
        onChainTransaction,
        pendingTransaction,
      });

      context.pendingTransactionsById.delete(pendingTransaction.id);
    }

    const remainingPendingCount = context.pendingTransactionsById.size;

    this.#logger.debug('Pending transactions reconciled', {
      noOfResolved: pendingCountBeforeReconcile - remainingPendingCount,
      noOfRemaining: remainingPendingCount,
    });
  }
  // #endregion

  #appendMappedTransaction(
    context: SyncContext,
    params: {
      keyringAccount: StellarKeyringAccount;
      onChainTransaction: Transaction;
      pendingTransaction?: KeyringTransaction;
    },
  ): void {
    const { keyringAccount, onChainTransaction, pendingTransaction } = params;

    const mappedTransaction = this.#transactionMapper.mapTransactionSafe({
      transaction: onChainTransaction,
      keyringAccount,
      transactionFromState: pendingTransaction,
      assetMetadata: context.sep41AssetsMetadata,
    });

    // Unmappable transactions (e.g. dust spam) are omitted from activity history.
    if (mappedTransaction) {
      pushToRecordArray(
        context.transactionsToSave,
        keyringAccount.id,
        mappedTransaction,
      );

      this.#appendSep41ReceiveMappingSafe(context, {
        keyringTransaction: mappedTransaction,
        senderKeyringAccount: keyringAccount,
      });
    }
  }

  /**
   * Best-effort SEP-41 receive mapping without failing the sync run.
   *
   * Horizon omits SEP-41 receives from the recipient's history. When a confirmed
   * sender-side SEP-41 send maps to another snap-managed account, clone that mapped
   * send as a receive for the recipient. Ineligible transactions are skipped silently;
   * unexpected errors are logged and ignored.
   *
   * @param context - Mutable sync run state including account lookup and save queue.
   * @param params - Mapped sender transaction and the account that produced it.
   * @param params.keyringTransaction - Mapped send from the sender's scan or reconcile.
   * @param params.senderKeyringAccount - Keyring account whose scan produced the send.
   */
  #appendSep41ReceiveMappingSafe(
    context: SyncContext,
    params: {
      keyringTransaction: KeyringTransaction;
      senderKeyringAccount: StellarKeyringAccount;
    },
  ): void {
    try {
      const { keyringTransaction, senderKeyringAccount } = params;

      const toAccountAddress =
        this.#getSep41RecipientAddressFromKeyringTransaction(
          keyringTransaction,
          senderKeyringAccount,
        );

      if (!toAccountAddress) {
        return;
      }

      const recipientAccount = context.allAccountsByAddress.get(
        toAccountAddress.toLowerCase(),
      );
      if (!recipientAccount) {
        return;
      }

      const mappedReceive = cloneDeep(keyringTransaction);
      mappedReceive.type = TransactionType.Receive;
      mappedReceive.account = recipientAccount.id;

      // Wallet-created sends can accumulate multiple status events; keep the latest only.
      if (mappedReceive.events.length > 1) {
        const latestEvent = mappedReceive.events.at(-1);
        mappedReceive.events = latestEvent
          ? [latestEvent]
          : mappedReceive.events;
      }

      pushToRecordArray(
        context.transactionsToSave,
        recipientAccount.id,
        mappedReceive,
      );
    } catch (error) {
      // Best effort to append the SEP-41 receive mapping,
      // The error is not necessary to track.
      // Not throwing the error to avoid blocking the sync.
      this.#logger.warn('Failed to append SEP-41 receive mapping', { error });
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
    const pendingTransactions = Array.from(
      context.pendingTransactionsById.values(),
    );

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
      transactions.concat(pendingTransactions),
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
        // Strip snap-internal reconcile metadata before keyring emit.
        transactions: Object.fromEntries(
          Object.entries(context.transactionsToSave).map(
            ([accountId, transactions]) => [
              accountId,
              toKeyringTransactions(transactions),
            ],
          ),
        ),
      },
    );
    this.#logger.debug('Transactions updated event emitted');
  }

  /**
   * Returns the recipient address when `transaction` is a confirmed SEP-41 send from
   * `senderKeyringAccount`.
   *
   * @param transaction - Mapped keyring transaction from the sender scan or reconcile.
   * @param senderKeyringAccount - Keyring account that produced the mapped send.
   * @returns Recipient Stellar address, or `null` when ineligible.
   */
  #getSep41RecipientAddressFromKeyringTransaction(
    transaction: KeyringTransaction,
    senderKeyringAccount: StellarKeyringAccount,
  ): string | null {
    const to = transaction.to?.[0];
    const from = transaction.from?.[0];
    const fromAsset = from?.asset;
    const toAsset = to?.asset;

    if (
      transaction.type !== TransactionType.Send ||
      !to ||
      !from ||
      !FungibleAssetStruct.is(fromAsset) ||
      !FungibleAssetStruct.is(toAsset) ||
      // The transaction is not confirmed.
      transaction.status !== TransactionStatus.Confirmed ||
      // The transaction is not a SEP-41 send from the sender's account.
      !isSameStr(from.address, senderKeyringAccount.address) ||
      // The transaction is a self transfer.
      isSameStr(from.address, to.address) ||
      // The transaction's from and to asset types do not match.
      !isSameStr(fromAsset.type, toAsset.type) ||
      // The transaction's asset is not a SEP-41 asset.
      !isSep41Id(fromAsset.type)
    ) {
      return null;
    }

    return to.address;
  }

  /**
   * Records a Horizon not-found reconcile attempt on a pending transaction.
   * Eviction is deferred to {@link TransactionRepository.saveMany} when both
   * `maxReconcileAttempts` and `maxPendingTransactionAge` are exceeded.
   *
   * @param context - Mutable sync run state including pending transactions.
   * @param transactionId - Pending transaction hash that Horizon did not return.
   */
  #incrementReconcileAttempt(
    context: SyncContext,
    transactionId: TransactionId,
  ): void {
    const transaction = context.pendingTransactionsById.get(transactionId);
    if (!transaction) {
      return;
    }

    const reconcileAttemptCount = (transaction.reconcileAttemptCount ?? 0) + 1;
    transaction.reconcileAttemptCount = reconcileAttemptCount;

    if (shouldDropPendingTransaction(transaction)) {
      this.#logger.debug(
        'Pending transaction eligible for eviction on save after max reconcile attempts and max age are exceeded',
        {
          transactionId,
          accountId: transaction.account,
          reconcileAttemptCount,
        },
      );
    }
  }
}
