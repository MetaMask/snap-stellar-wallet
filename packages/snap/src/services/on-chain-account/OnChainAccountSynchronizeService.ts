import { KeyringEvent } from '@metamask/keyring-api';
import type { KeyringEventPayload } from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { Mutex } from 'async-mutex';
import { BigNumber } from 'bignumber.js';

import type { SpendableBalance } from './api';
import { OnChainAccount } from './OnChainAccount';
import type { OnChainAccountRepository } from './OnChainAccountRepository';
import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getSlip44AssetId,
  getSnapProvider,
  isSep41Id,
  toDisplayBalance,
} from '../../utils';
import type { StellarKeyringAccount } from '../account';
import type { StellarAssetMetadata } from '../asset-metadata';
import type { AssetMetadataService } from '../asset-metadata/AssetMetadataService';
import { AccountNotActivatedException, type NetworkService } from '../network';

type AccountAssetListDelta =
  KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>['assets'][string];

type ActivatedAccountPair = {
  keyringAccount: StellarKeyringAccount;
  onChainAccount: OnChainAccount;
};

type Sep41BalanceFetchResult = {
  assetIds: KnownCaip19Sep41AssetId[];
  assetMetadataByAssetId: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>;
  balancesByAccountId: Record<
    string,
    Record<string, BigNumber | null | undefined>
  >;
};

/**
 * Persists on-chain account snapshots and emits keyring balance / asset-list events after a sync.
 *
 * {@link synchronize} uses a mutex so overlapping syncs cannot interleave read–merge–write across
 * `findByKeyringAccountIds` and `saveMany`. Each `saveMany` call is still one atomic `IStateManager.update`.
 */
export class OnChainAccountSynchronizeService {
  readonly #networkService: NetworkService;

  readonly #onChainAccountRepository: OnChainAccountRepository;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #logger: ILogger;

  /** Serializes full sync runs; see class JSDoc. */
  readonly #synchronizeMutex = new Mutex();

  constructor({
    networkService,
    onChainAccountRepository,
    assetMetadataService,
    logger,
  }: {
    networkService: NetworkService;
    onChainAccountRepository: OnChainAccountRepository;
    assetMetadataService: AssetMetadataService;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#onChainAccountRepository = onChainAccountRepository;
    this.#assetMetadataService = assetMetadataService;
    this.#logger = createPrefixedLogger(
      logger,
      '[💼 OnChainAccountSynchronizeService]',
    );
  }

  /**
   * Enriches accounts with SEP-41 balances, persists snapshots, then notifies the keyring when
   * balances or the non-native tracked asset set changed.
   *
   * @param keyringAccounts - Stellar keyring accounts to sync for `scope`.
   * @param scope - CAIP-2 network.
   */
  async synchronize(
    keyringAccounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    if (keyringAccounts.length === 0) {
      this.#logger.debug('No accounts to synchronize');
      return;
    }

    // Adding a mutex to prevent multiple syncs from running simultaneously,
    // And ensure the read and write consistency in state.
    // Trade off of the mutex: Synchronize request may send every second, due to user switch accounts, we will block the next request until the current request is finished.
    await this.#synchronizeMutex.runExclusive(async () => {
      this.#logger.debug('Load on-chain accounts - no of accounts to load', {
        noOfAccounts: keyringAccounts.length,
      });
      // 1. Horizon: funded accounts only (unfunded / errors skipped in #loadActivatedPairs).
      const activatedAccountPairs = await this.#loadActivatedPairs(
        keyringAccounts,
        scope,
      );
      this.#logger.debug(
        'Loaded activated account pairs - no of accounts loaded',
        {
          noOfAccounts: activatedAccountPairs.length,
        },
      );
      if (activatedAccountPairs.length === 0) {
        return;
      }

      const stellarAccountIds: string[] = [];
      const keyringAccountIds: string[] = [];
      for (const { keyringAccount, onChainAccount } of activatedAccountPairs) {
        keyringAccountIds.push(keyringAccount.id);
        stellarAccountIds.push(onChainAccount.accountId);
      }

      // 2. SEP-41 token balances (best effort):
      // - Try to load each tracked SEP-41 token for every activated account.
      // - If this step throws, the rest of the sync still runs; step 4 can copy missing tokens from the last snapshot.
      this.#logger.debug('Load SEP-41 token balances');
      let sep41BalanceFetchResult: Sep41BalanceFetchResult | null = null;
      try {
        const sep41Assets = await this.#fetchSep41AssetOrSyncOnce(scope);
        sep41BalanceFetchResult = await this.#synchronizeSep41AssetBalances({
          stellarAccountIds,
          scope,
          sep41Assets,
        });
      } catch (error: unknown) {
        this.#logger.logErrorWithDetails(
          'SEP-41 token balance step failed; merge will reuse last-saved SEP-41 token rows where needed',
          error,
        );
      }

      // 3. Snap state: latest serialized snapshots before this run (merge source + keyring diff baseline).
      this.#logger.debug('Load latest state snapshots for on-chain accounts');
      const latestSerializedAccountSnapshotByKeyringId =
        await this.#onChainAccountRepository.findByKeyringAccountIds(
          keyringAccountIds,
          scope,
        );
      const lengthOfSnapshot = Object.keys(
        latestSerializedAccountSnapshotByKeyringId,
      ).filter((snapshot) => snapshot !== null).length;
      this.#logger.debug(
        'Loaded latest state snapshots for on-chain accounts - no of accounts loaded',
        {
          noOfAccounts: lengthOfSnapshot,
          newActivatedAccountPairs:
            activatedAccountPairs.length - lengthOfSnapshot,
        },
      );
      // 4. Per activated account:
      // - apply fetched SEP-41 balances (if the fetch step succeeded),
      // - restore unresolved SEP-41 rows from the latest state snapshot,
      // - compute keyring event deltas,
      // - prepare the serialized snapshot payload for one batched save.
      const snapshotsToSave: Record<string, OnChainAccountSerializableFull> =
        {};
      let balancesPayload:
        | KeyringEventPayload<KeyringEvent.AccountBalancesUpdated>['balances']
        | null = null;
      let assetsPayload:
        | KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>['assets']
        | null = null;

      this.#logger.debug('Diff full snapshots for on-chain accounts');
      for (const {
        keyringAccount,
        onChainAccount: synchronizedOnChainAccount,
      } of activatedAccountPairs) {
        const keyringAccountId = keyringAccount.id;
        const latestStateSnapshotSerialized =
          latestSerializedAccountSnapshotByKeyringId[keyringAccountId] ?? null;
        const stateSnapshotOnChainAccount =
          latestStateSnapshotSerialized === null
            ? null
            : OnChainAccount.fromSerializable(latestStateSnapshotSerialized);
        const unresolvedSep41AssetIds = this.#setSep41BalancesForAccount(
          synchronizedOnChainAccount,
          sep41BalanceFetchResult,
        );

        // fill gaps for SEP-41 tokens using the last saved snapshot from State:
        // - If step 2 failed completely, copy every SEP-41 token row from the snapshot that is still missing on `synchronizedOnChainAccount`.
        // - If step 2 ran but some token ids failed, copy only those ids from the snapshot when they are still missing.
        // - Any SEP-41 token that already has a row from step 2 is left unchanged here.
        this.#mergePersistedSep41Rows(
          synchronizedOnChainAccount,
          stateSnapshotOnChainAccount,
          unresolvedSep41AssetIds,
        );

        const { balanceChanges, assetListChanges } =
          this.#computeKeyringSyncDeltas(
            stateSnapshotOnChainAccount,
            synchronizedOnChainAccount,
          );

        balancesPayload ??= {};
        balancesPayload[keyringAccountId] = balanceChanges;
        this.#logger.debug(
          'Prepared account balance payload for keyring account',
          {
            keyringAccountId,
            balanceEntriesLength: Object.keys(balanceChanges).length,
          },
        );
        if (assetListChanges !== null) {
          assetsPayload ??= {};
          assetsPayload[keyringAccountId] = assetListChanges;
          this.#logger.debug(
            'Differences in full snapshots for keyring account - asset list changes',
            {
              keyringAccountId,
              assetListChangesLength: Object.keys(assetListChanges).length,
            },
          );
        }

        snapshotsToSave[keyringAccountId] =
          synchronizedOnChainAccount.toSerializableFull();
      }

      // 5. Save the snapshots to the State.
      this.#logger.debug('Save snapshots to the State');
      await this.#onChainAccountRepository.saveMany(snapshotsToSave);

      // 6. Emit keyring events after persistence.
      this.#logger.debug('Emit keyring events');
      await this.#emitKeyringEvents(balancesPayload, assetsPayload);
    });
  }

  /**
   * Loads each account from Horizon; skips unfunded accounts and logs other failures.
   *
   * @param accounts - Keyring accounts to load.
   * @param scope - CAIP-2 network to query.
   * @returns Pairs keyed for SEP-41 sync and persistence.
   */
  async #loadActivatedPairs(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<ActivatedAccountPair[]> {
    const pairs: ActivatedAccountPair[] = [];

    const results = await Promise.allSettled(
      accounts.map(async (account) => ({
        keyringAccount: account,
        onChainAccount: await this.#networkService.loadOnChainAccount(
          account.address,
          scope,
        ),
      })),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        pairs.push(result.value);
        return;
      }
      if (result.reason instanceof AccountNotActivatedException) {
        return;
      }
      this.#logger.logErrorWithDetails('Failed to load account for sync', {
        accountId: accounts[index]?.id,
        error: result.reason,
      });
    });

    return pairs;
  }

  /**
   * Loads SEP-41 token balances from the network (no per-account mutation here).
   *
   * @param params - Parameters for the SEP-41 balance fetch.
   * @param params.stellarAccountIds - Stellar account ids to query in one batch call.
   * @param params.scope - Network to query.
   * @param params.sep41Assets - SEP-41 assets to query in one batch call.
   * @returns Shared SEP-41 inputs consumed in the main synchronize loop.
   */
  async #synchronizeSep41AssetBalances({
    stellarAccountIds,
    scope,
    sep41Assets,
  }: {
    stellarAccountIds: string[];
    scope: KnownCaip2ChainId;
    sep41Assets: StellarAssetMetadata[];
  }): Promise<Sep41BalanceFetchResult> {
    const assetIds: KnownCaip19Sep41AssetId[] = [];
    const assetMetadataByAssetId = sep41Assets.reduce<
      Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>
    >((acc, asset) => {
      const assetId = asset.assetId as KnownCaip19Sep41AssetId;
      acc[assetId] = asset;
      assetIds.push(assetId);
      return acc;
    }, {});

    // One batched balance read: Stellar account id → balance per SEP-41 token id.
    const sep41AssetBalancesByAccount =
      await this.#networkService.getSep41AssetBalances({
        accounts: stellarAccountIds,
        assetIds,
        scope,
      });

    return {
      assetIds,
      assetMetadataByAssetId,
      balancesByAccountId: sep41AssetBalancesByAccount,
    };
  }

  async #fetchSep41AssetOrSyncOnce(
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    // Get all SEP-41 assets for the given scope.
    const allAssets = await this.#assetMetadataService.getAllByScope(scope);

    if (allAssets.length === 0) {
      this.#logger.debug('No assets found in the state, synchronizing assets');
      // It is possible that the state is empty, due to the first sync.
      // Hence, we synchronize the assets once.
      await this.#assetMetadataService.synchronize(scope);
    }

    const sep41Assets =
      await this.#assetMetadataService.getPersistedSep41AssetsMetadata(scope);

    this.#logger.debug('SEP-41 assets found in the state', {
      noOfAssets: sep41Assets.length,
    });

    return sep41Assets;
  }

  /**
   * Applies fetched SEP-41 balances for one account and returns unresolved token ids.
   *
   * Returning `undefined` means the whole SEP-41 fetch step failed; merge will copy any missing
   * persisted SEP-41 rows. Returning a set means the fetch step succeeded and merge should only
   * restore rows for token ids still unresolved here.
   *
   * @param onChainAccount - In-memory account after classic Horizon load; receives SEP-41 rows including zero balances.
   * @param sep41BalanceFetchResult - Batch balance/symbol data from the SEP-41 step, or `null` if that step failed.
   * @returns Token ids that could not be resolved to a balance (for merge from last snapshot), or `undefined` if the fetch step did not run.
   */
  #setSep41BalancesForAccount(
    onChainAccount: OnChainAccount,
    sep41BalanceFetchResult: Sep41BalanceFetchResult | null,
  ): Set<KnownCaip19Sep41AssetId> | undefined {
    if (sep41BalanceFetchResult === null) {
      return undefined;
    }

    const unresolvedSep41AssetIds = new Set<KnownCaip19Sep41AssetId>();
    const sep41AssetBalances =
      sep41BalanceFetchResult.balancesByAccountId[onChainAccount.accountId] ??
      {};
    for (const assetId of sep41BalanceFetchResult.assetIds) {
      const balance = sep41AssetBalances[assetId];
      const assetMetadata =
        sep41BalanceFetchResult.assetMetadataByAssetId[assetId];

      if (!assetMetadata) {
        continue;
      }

      const { decimals } = assetMetadata.units[0];
      const { symbol } = assetMetadata;

      // No balance value for this SEP-41 token,
      // it means some error occurred during the balance fetch (but not balance is zero).
      // mark unresolved so the merge step can reuse the last snapshot row.
      if (balance === null || balance === undefined) {
        unresolvedSep41AssetIds.add(assetId);
        continue;
      }

      // Persist the SEP-41 asset when a balance value was fetched, including a zero balance.
      // Missing balances from fetch errors are handled above as unresolved for merge/backfill.
      onChainAccount.setSep41Asset(assetId, {
        balance,
        symbol,
        decimals,
      });
    }

    if (unresolvedSep41AssetIds.size > 0) {
      this.#logger.debug('SEP-41 balances unresolved for account', {
        accountId: onChainAccount.accountId,
        unresolvedAssetIds: Array.from(unresolvedSep41AssetIds),
      });
    }

    return unresolvedSep41AssetIds;
  }

  /**
   * Fills missing **SEP-41 token** rows on `current` using the **last saved snap snapshot** (`persisted`).
   * This is normal persisted JSON state, not a temporary cache.
   *
   * Behaviour:
   * - Only rows for SEP-41 tokens; skip tokens already on `current`.
   * - If `unresolvedSep41AssetIds` is omitted (whole SEP-41 balance step failed): copy every matching persisted row still missing on `current`.
   * - If it is a set (step ran): copy only persisted rows whose token id is in the set and still missing on `current`.
   *
   * @param current - In-memory account after classic load + any SEP-41 token balances from this run.
   * @param persisted - Same account’s snapshot from before this sync (`null` if none).
   * @param unresolvedSep41AssetIds - See “Behaviour” above.
   * @returns `current` with allowed gaps filled from `persisted`.
   */
  #mergePersistedSep41Rows(
    current: OnChainAccount,
    persisted: OnChainAccount | null,
    unresolvedSep41AssetIds?: Set<KnownCaip19Sep41AssetId>,
  ): OnChainAccount {
    if (!persisted) {
      return current;
    }

    const shouldBackfillAll = unresolvedSep41AssetIds === undefined;

    // Try best effort backfill for SEP-41 assets from the last saved snapshot.
    for (const assetId of persisted.assetIds) {
      if (!isSep41Id(assetId) || current.hasAsset(assetId)) {
        continue;
      }

      // Whole SEP-41 step failed -> backfill all missing rows.
      // Partial failure -> backfill only unresolved ids.
      if (!shouldBackfillAll && !unresolvedSep41AssetIds.has(assetId)) {
        continue;
      }

      const assetBalance = persisted.getAsset(assetId);
      if (assetBalance === undefined) {
        continue;
      }

      current.setSep41Asset(assetId, {
        balance: new BigNumber(assetBalance.balance),
        symbol: assetBalance.symbol,
        decimals: assetBalance.decimals,
      });
    }

    return current;
  }

  /**
   * Compares persisted on-chain state to the account after this sync and produces keyring
   * event data: full per-asset balance payload and non-native token add/remove.
   *
   * @param stateSnapshotOnChainAccount - Last saved account from state, or `null` when none exists.
   * @param synchronizedOnChainAccount - Same account after Horizon, SEP-41, and merge steps.
   * @returns `balanceChanges` for all known assets plus optional `assetListChanges`.
   */
  #computeKeyringSyncDeltas(
    stateSnapshotOnChainAccount: OnChainAccount | null,
    synchronizedOnChainAccount: OnChainAccount,
  ): {
    balanceChanges: Record<string, { unit: string; amount: string }>;
    assetListChanges: AccountAssetListDelta | null;
  } {
    const nativeAssetId = getSlip44AssetId(synchronizedOnChainAccount.scope);
    const assetIds = new Set<KnownCaip19AssetIdOrSlip44Id>([
      ...(stateSnapshotOnChainAccount?.assetIds ?? []),
      ...synchronizedOnChainAccount.assetIds,
    ]);

    const balanceChanges: Record<string, { unit: string; amount: string }> = {};
    const addedAssets: AccountAssetListDelta['added'] = [];
    const removedAssets: AccountAssetListDelta['removed'] = [];

    for (const assetId of assetIds) {
      const latestStateRow =
        stateSnapshotOnChainAccount === null
          ? undefined
          : stateSnapshotOnChainAccount.getAsset(assetId);
      const currentRow = synchronizedOnChainAccount.getAsset(assetId);

      // Always send the full balance snapshot, even when values did not change.
      // This lets the client recover if it missed a previous balances event.
      // Example with 4 assets:
      // - XLM (native), USDC classic trustline, EURC classic trustline, SOLBTC SEP-41.
      // ------------------------- Sync 1 ------------------------------------------
      // - Sync 1 (success): payload received by client:
      //   XLM=10, USDC=25, EURC=0, SOLBTC=5.
      // ------------------------- Sync 2 ------------------------------------------
      // - Sync 2 (client misses event): chain updates to
      //   XLM=11, USDC=30, EURC trustline removed (it was already zero), SOLBTC=0.
      //   Payload for this sync would include EURC amount=0 and SOLBTC amount=0,
      //   but client missed it.
      // ------------------------- Sync 3 ------------------------------------------
      // - Sync 3 (client misses event): chain updates to
      //   XLM=9, USDC=30, SOLBTC still 0.
      //   Because SEP-41 zero balances are persisted, payload still includes SOLBTC=0.
      // ------------------------- Sync 4 ------------------------------------------
      // - Sync 4 (success): we still emit full balances for current + latest snapshot,
      //   so payload includes XLM=9, USDC=30, SOLBTC=0.
      //   (EURC stays removed because trustline rows are not persisted once removed.)
      balanceChanges[assetId as string] = this.#buildBalancePayloadRow(
        currentRow,
        latestStateRow,
      );

      if (assetId === nativeAssetId) {
        continue;
      }

      const isLatestVisible = this.#isAssetVisible(assetId, latestStateRow);
      const isCurrentVisible = this.#isAssetVisible(assetId, currentRow);
      // Add/remove is based on visibility transition between snapshots.
      if (isCurrentVisible && !isLatestVisible) {
        addedAssets.push(assetId);
      }

      if (isLatestVisible && !isCurrentVisible) {
        // TBC: test to evaluate if we dont remove the asset will be best behaviour from client perspective
        // as for now, we remove the asset if it cant found from the latest snapshot regardless it is trustline or SEP-41
        // which means,
        // if a trustline asset is removed, the client will remove the token from the home page (shall we remove?)
        // For SEP-41, it is always in state, the client will not remove the token from the home page (same as non EVM)
        // removedAssets.push(assetId);
      }
    }

    return {
      balanceChanges,
      assetListChanges:
        addedAssets.length > 0 || removedAssets.length > 0
          ? {
              added: addedAssets,
              removed: removedAssets,
            }
          : null,
    };
  }

  #buildBalancePayloadRow(
    currentRow: SpendableBalance | undefined,
    latestStateRow: SpendableBalance | undefined,
  ): { unit: string; amount: string } {
    return {
      // When an asset was removed this sync, `currentRow` is missing.
      // In that case, use the last known symbol from the persisted snapshot.
      unit: currentRow?.symbol ?? latestStateRow?.symbol ?? '',
      amount: toDisplayBalance(
        currentRow?.balance ?? new BigNumber(0),
        currentRow?.decimals ?? latestStateRow?.decimals,
      ),
    };
  }

  #isAssetVisible(
    assetId: KnownCaip19AssetIdOrSlip44Id,
    row: SpendableBalance | undefined,
  ): boolean {
    if (!row) {
      return false;
    }
    return !isSep41Id(assetId) || !row.balance.isZero();
  }

  async #emitKeyringEvents(
    balancesPayload:
      | KeyringEventPayload<KeyringEvent.AccountBalancesUpdated>['balances']
      | null,
    assetsPayload:
      | KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>['assets']
      | null,
  ): Promise<void> {
    try {
      if (balancesPayload !== null) {
        await emitSnapKeyringEvent(
          getSnapProvider(),
          KeyringEvent.AccountBalancesUpdated,
          { balances: balancesPayload },
        );
      }
      if (assetsPayload !== null) {
        await emitSnapKeyringEvent(
          getSnapProvider(),
          KeyringEvent.AccountAssetListUpdated,
          { assets: assetsPayload },
        );
      }
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to emit keyring events after synchronize',
        error,
      );
    }
  }
}
