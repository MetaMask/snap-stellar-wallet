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
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getSlip44AssetId,
  getSnapProvider,
  isClassicAssetId,
  isSep41Id,
  toDisplayBalance,
} from '../../utils';
import type { StellarAssetMetadata } from '../asset-metadata';
import type { NetworkService } from '../network';
import type { ActivatedAccountPair } from '../sync/api';

type AccountAssetListDelta =
  KeyringEventPayload<KeyringEvent.AccountAssetListUpdated>['assets'][string];

type Sep41BalanceFetchResult = {
  assetIds: KnownCaip19Sep41AssetId[];
  assetMetadataByAssetId: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>;
  balancesByAccountId: Record<
    string,
    Record<string, BigNumber | null | undefined>
  >;
};

/**
 * Persists on-chain account snapshots (source of truth) before emitting keyring balance / asset-list events.
 *
 * {@link synchronize} uses a mutex so overlapping syncs cannot interleave read–merge–write across
 * `findByKeyringAccountIds` and `saveMany`. Each `saveMany` call is still one atomic `IStateManager.update`.
 */
export class OnChainAccountSynchronizeService {
  readonly #networkService: NetworkService;

  readonly #onChainAccountRepository: OnChainAccountRepository;

  readonly #logger: ILogger;

  /** Serializes full sync runs; see class JSDoc. */
  readonly #synchronizeMutex = new Mutex();

  constructor({
    networkService,
    onChainAccountRepository,
    logger,
  }: {
    networkService: NetworkService;
    onChainAccountRepository: OnChainAccountRepository;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#onChainAccountRepository = onChainAccountRepository;
    this.#logger = createPrefixedLogger(
      logger,
      '[💼 OnChainAccountSynchronizeService]',
    );
  }

  /**
   * Enriches accounts with SEP-41 balances, merges classic removal tombstones, persists snapshots,
   * then notifies the keyring. State is written first so client handlers that round-trip into the
   * snap for balances always see the new source of truth. Classic tombstones (`limit` 0) keep
   * removals reconcilable if a keyring emit fails.
   *
   * @param activatedAccountPairs - Activated keyring/on-chain account pairs to sync for `scope`.
   * @param scope - CAIP-2 network.
   * @param sep41Assets - Preloaded SEP-41 assets from {@link SynchronizeService}.
   */
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
    this.#logger.debug(`Synchronize on-chain accounts started at ${startTime}`);
    // Mutex: prevent overlapping sync runs and keep read–merge–write consistent with state.
    // Trade-off: sync requests may arrive frequently (e.g. when users switch accounts); the next
    // request waits until the in-flight one finishes.
    await this.#synchronizeMutex
      .runExclusive(async () => {
        this.#logger.debug(
          `Synchronize on-chain accounts mutex acquired at ${Date.now()}`,
        );

        const stellarAccountIds: string[] = [];
        const keyringAccountIds: string[] = [];
        for (const {
          keyringAccount,
          onChainAccount,
        } of activatedAccountPairs) {
          keyringAccountIds.push(keyringAccount.id);
          stellarAccountIds.push(onChainAccount.accountId);
        }

        // 2. SEP-41 token balances (best effort):
        // - Try to load each tracked SEP-41 token for every activated account.
        // - If this step throws, the rest of the sync still runs; step 4 can copy missing tokens from the last snapshot.
        this.#logger.debug('Load SEP-41 token balances');
        let sep41BalanceFetchResult: Sep41BalanceFetchResult | null = null;
        try {
          sep41BalanceFetchResult = await this.#synchronizeSep41AssetBalances({
            stellarAccountIds,
            scope,
            sep41Assets,
          });
        } catch (error: unknown) {
          this.#logger.logErrorWithDetails(
            'SEP-41 token balance step failed; merge will reuse last-saved SEP-41 asset entries where needed',
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
        const lengthOfSnapshot = Object.values(
          latestSerializedAccountSnapshotByKeyringId,
        ).filter((snapshot) => snapshot !== null).length;
        this.#logger.debug(
          'Loaded latest state snapshots for on-chain accounts - number of accounts loaded',
          {
            noOfAccounts: lengthOfSnapshot,
            newActivatedAccountPairs:
              activatedAccountPairs.length - lengthOfSnapshot,
          },
        );
        // 4. Per activated account:
        // - apply fetched SEP-41 balances (if the fetch step succeeded),
        // - merge persisted snapshot gaps (SEP-41 backfill + classic removal tombstones),
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
            latestSerializedAccountSnapshotByKeyringId[keyringAccountId] ??
            null;
          const stateSnapshotOnChainAccount =
            latestStateSnapshotSerialized === null
              ? null
              : OnChainAccount.fromSerializable(latestStateSnapshotSerialized);
          const unresolvedSep41AssetIds = this.#setSep41BalancesForAccount(
            synchronizedOnChainAccount,
            sep41BalanceFetchResult,
          );

          // Fill gaps from the last saved snapshot: SEP-41 backfill + classic removal tombstones.
          // SEP-41: if step 2 failed completely, copy every missing SEP-41 entry; if step 2 ran,
          // copy only entries for token ids still unresolved. Classic: re-inject tombstone entries when
          // Horizon dropped a trustline that persisted state still had (or limit 0 tombstone).
          this.#mergePersistedEntriesIntoOnChainAccount(
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

        // 5. Save the snapshots to the State first.
        // The client may request balances from the snap as soon as it handles the keyring event,
        // so persisted state must already reflect the new snapshot.
        this.#logger.debug('Save snapshots to the State');
        await this.#onChainAccountRepository.saveMany(snapshotsToSave);

        // 6. Emit keyring events after persistence.
        this.#logger.debug('Emit keyring events');
        await this.#emitKeyringEvents(balancesPayload, assetsPayload);
      })
      .finally(() => {
        const endTime = Date.now();
        this.#logger.debug(
          `Synchronize completed at ${endTime} in ${endTime - startTime}ms`,
        );
      });
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

  /**
   * Applies fetched SEP-41 balances for one account and returns unresolved token ids.
   *
   * Returning `undefined` means the whole SEP-41 fetch step failed; merge will copy any missing
   * persisted SEP-41 entries. Returning a set means the fetch step succeeded and merge should only
   * restore entries for token ids still unresolved here.
   *
   * @param onChainAccount - In-memory account after classic Horizon load; receives SEP-41 entries including zero balances.
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

      // No balance value for this SEP-41 token: treat as a fetch error (not the same as balance zero).
      // Mark unresolved so the merge step can reuse the last snapshot entry.
      if (balance === null || balance === undefined) {
        unresolvedSep41AssetIds.add(assetId);
        continue;
      }

      // Persist the SEP-41 asset when a balance value was fetched, including a zero balance.
      // Missing balances from fetch errors are handled above as unresolved for merge/backfill.
      onChainAccount.setAsset(assetId, {
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
   * Copies selected asset entries from the last saved snapshot onto `onChainAccount` when that
   * in-memory on-chain view is missing them after Horizon + SEP-41 fetch.
   *
   * **SEP-41:** If `unresolvedSep41AssetIds` is omitted (whole SEP-41 step failed), backfill every
   * missing SEP-41 entry from `persisted`. If it is a set (step ran), backfill only ids still in the
   * set and missing on `onChainAccount`. Entries already on `onChainAccount` are unchanged.
   *
   * **Classic:** When Horizon omits a trustline still present in `persisted` (or a stored
   * tombstone with `limit` 0), re-inject a tombstone entry so state and keyring payloads stay aligned.
   *
   * @param onChainAccount - In-memory account after Horizon load and SEP-41 application for this run.
   * @param persisted - Same account’s snapshot from before this sync (`null` if none).
   * @param unresolvedSep41AssetIds - When omitted, backfill all missing SEP-41 from snapshot; when a set, only those token ids when still missing on `onChainAccount`.
   * @returns The same `onChainAccount` instance (mutated).
   */
  #mergePersistedEntriesIntoOnChainAccount(
    onChainAccount: OnChainAccount,
    persisted: OnChainAccount | null,
    unresolvedSep41AssetIds?: Set<KnownCaip19Sep41AssetId>,
  ): OnChainAccount {
    if (!persisted) {
      return onChainAccount;
    }

    const shouldBackfillAllSep41 = unresolvedSep41AssetIds === undefined;

    for (const assetId of persisted.rawAssetIds) {
      if (onChainAccount.getRawAsset(assetId) !== undefined) {
        continue;
      }

      if (isSep41Id(assetId)) {
        if (
          !shouldBackfillAllSep41 &&
          unresolvedSep41AssetIds !== undefined &&
          !unresolvedSep41AssetIds.has(assetId)
        ) {
          continue;
        }

        const assetBalance = persisted.getRawAsset(assetId);
        if (assetBalance === undefined) {
          continue;
        }

        onChainAccount.setAsset(assetId, {
          balance: new BigNumber(assetBalance.balance),
          symbol: assetBalance.symbol,
          decimals: assetBalance.decimals,
        });
        continue;
      }

      if (!isClassicAssetId(assetId)) {
        continue;
      }

      const persistedEntry = persisted.getRawAsset(assetId);
      if (
        persistedEntry?.limit === undefined ||
        persistedEntry.address === undefined
      ) {
        continue;
      }

      const authorized = persistedEntry.authorized ?? true;
      onChainAccount.setAsset(assetId, {
        balance: new BigNumber(0),
        symbol: persistedEntry.symbol,
        limit: new BigNumber(0),
        address: persistedEntry.address,
        authorized,
        ...(persistedEntry.sponsored === undefined
          ? {}
          : { sponsored: persistedEntry.sponsored }),
      });
    }

    return onChainAccount;
  }

  /**
   * Compares persisted on-chain state to the account after this sync and produces keyring
   * event data: full per-asset balance payload and non-native token add/remove.
   *
   * @param stateSnapshotOnChainAccount - Last saved account from state, or `null` when none exists.
   * @param synchronizedOnChainAccount - Same account after Horizon, SEP-41, and merge steps.
   * @returns `balanceChanges` for on-chain-visible assets plus `assetListChanges` from state/on-chain visibility transitions.
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
      ...(stateSnapshotOnChainAccount?.rawAssetIds ?? []),
      ...synchronizedOnChainAccount.rawAssetIds,
    ]);

    const balanceChanges: Record<string, { unit: string; amount: string }> = {};
    const addedAssets: AccountAssetListDelta['added'] = [];
    const removedAssets: AccountAssetListDelta['removed'] = [];

    for (const assetId of assetIds) {
      const latestStateEntry =
        stateSnapshotOnChainAccount === null
          ? undefined
          : stateSnapshotOnChainAccount.getRawAsset(assetId);
      const onChainEntry = synchronizedOnChainAccount.getRawAsset(assetId);

      // assetIds = union of state + on-chain rawAssetIds (includes tombstones and zero SEP-41).
      // Asset list is transition-based between persisted state and the on-chain view for this sync:
      // newly visible on-chain vs state → added; no longer visible on-chain vs state → removed.
      // Native is always included in added. When state already matches on-chain, asset-list deltas
      // are empty aside from native (no replay of prior removals). Balances are emitted only for
      // on-chain-visible assets; the client drops stale balance keys when it handles asset removed.
      // Example: XLM (native), USDC/EURC/AQUA (classic trustlines), SOLBTC (SEP-41).
      // ------------------------- Sync 1 ------------------------------------------
      // - Sync 1 (success): payload received by client:
      //   state view: none (new account).
      //   onChain view: XLM=10, USDC=25, EURC=0, SOLBTC=5.
      //   balance payload: XLM=10, USDC=25, EURC=0, SOLBTC=5.
      //   asset list payload: added XLM, USDC, EURC, SOLBTC; removed none.
      // ------------------------- Sync 2 ------------------------------------------
      // - Sync 2 (client misses event):
      //   state view: XLM=10, USDC=25, EURC=0, SOLBTC=5.
      //   onChain view: XLM=11, USDC=30, AQUA trustline added, EURC trustline removed, SOLBTC=0.
      //   balance payload: XLM=11, USDC=30, AQUA=0.
      //   asset list payload: added XLM, AQUA; removed EURC, SOLBTC.
      // ------------------------- Sync 3 ------------------------------------------
      // - Sync 3 (client misses event):
      //   state view: XLM=11, USDC=30, AQUA trustline, EURC tombstone, SOLBTC=0.
      //   onChain view: XLM=9, USDC=30, AQUA trustline, EURC tombstone, SOLBTC=0.
      //   balance payload: XLM=9, USDC=30, AQUA=0.
      //   asset list payload: added XLM only; removed none (visibility unchanged vs state).
      // ------------------------- Sync 4 ------------------------------------------
      // - Sync 4 (success): payload received by client:
      //   state view: XLM=9, USDC=30, AQUA trustline, EURC tombstone, SOLBTC=0.
      //   onChain view: XLM=9, USDC=30, AQUA trustline, EURC tombstone, SOLBTC=0.
      //   balance payload: XLM=9, USDC=30, AQUA=0.
      //   asset list payload: added XLM only; removed none (state matches on-chain).
      const isVisibleFromOnChain = this.#isAssetVisible(assetId, onChainEntry);
      const isVisibleFromState = this.#isAssetVisible(
        assetId,
        latestStateEntry,
      );

      // Asset list: transition-based add/remove between persisted state and on-chain visibility.
      if (!isVisibleFromState && isVisibleFromOnChain) {
        addedAssets.push(assetId);
      }

      if (isVisibleFromState && !isVisibleFromOnChain) {
        removedAssets.push(assetId);
      }

      // Balance: on-chain-visible assets only (tombstones and zero SEP-41 omitted).
      // There is no need to emit balance for assets that are not visible from on-chain.
      // The client controller will remove the balance entry if they receive a asset list event with the asset removed.
      if (isVisibleFromOnChain) {
        balanceChanges[assetId as string] =
          assetId === nativeAssetId
            ? {
                unit: NATIVE_ASSET_SYMBOL,
                amount: toDisplayBalance(
                  synchronizedOnChainAccount.nativeRawBalance,
                ),
              }
            : this.#buildBalancePayloadFromEntries(
                onChainEntry,
                latestStateEntry,
              );
      }
    }

    // Native is always persisted on activated accounts;
    if (!addedAssets.includes(nativeAssetId)) {
      addedAssets.push(nativeAssetId);
    }

    return {
      balanceChanges,
      assetListChanges: {
        added: addedAssets,
        removed: removedAssets,
      },
    };
  }

  #buildBalancePayloadFromEntries(
    onChainEntry: SpendableBalance | undefined,
    latestStateEntry: SpendableBalance | undefined,
  ): { unit: string; amount: string } {
    return {
      // When an asset was removed this sync, `onChainEntry` may be missing or be a classic tombstone
      // (`limit` 0). Use the last known symbol from the persisted snapshot when needed.
      unit: onChainEntry?.symbol ?? latestStateEntry?.symbol ?? '',
      amount: toDisplayBalance(
        onChainEntry?.balance ?? new BigNumber(0),
        onChainEntry?.decimals ?? latestStateEntry?.decimals,
      ),
    };
  }

  #isAssetVisible(
    assetId: KnownCaip19AssetIdOrSlip44Id,
    entry: SpendableBalance | undefined,
  ): boolean {
    if (!entry) {
      return false;
    }
    if (isSep41Id(assetId)) {
      return !entry.balance.isZero();
    }
    if (isClassicAssetId(assetId)) {
      if (entry.limit === undefined) {
        return false;
      }
      return entry.limit.gt(0);
    }
    return true;
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
