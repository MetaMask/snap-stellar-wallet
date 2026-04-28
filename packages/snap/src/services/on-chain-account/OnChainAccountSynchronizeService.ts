import { KeyringEvent } from '@metamask/keyring-api';
import type { KeyringEventPayload } from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { Mutex } from 'async-mutex';
import { BigNumber } from 'bignumber.js';

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
} from '../../utils';
import type { StellarKeyringAccount } from '../account';
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
  symbolsByAssetId: Record<KnownCaip19Sep41AssetId, string>;
  balancesByAccountId: Record<
    string,
    Record<string, BigNumber | null | undefined>
  >;
};

/**
 * Persists on-chain account snapshots and emits keyring balance / asset-list events after a sync.
 *
 * {@link synchronize} uses a mutex so overlapping syncs cannot interleave read–merge–write across
 * `findByAccountIds` and `saveMany`. Each `saveMany` call is still one atomic `IStateManager.update`.
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
        sep41BalanceFetchResult = await this.#synchronizeSep41AssetBalances(
          stellarAccountIds,
          scope,
        );
      } catch {
        this.#logger.debug(
          'SEP-41 token balance step failed; merge will reuse last-saved SEP-41 token rows where needed',
        );
      }

      // 3. Snap state: latest serialized snapshots before this run (merge source + keyring diff baseline).
      this.#logger.debug('Load latest state snapshots for on-chain accounts');
      const latestSerializedAccountSnaphotByKeyringId =
        await this.#onChainAccountRepository.findByAccountIds(
          keyringAccountIds,
          scope,
        );
      const lengthOfSnapshot = Object.keys(
        latestSerializedAccountSnaphotByKeyringId,
      ).length;
      this.#logger.debug(
        'Loaded latest state snapshots for on-chain accounts - no of accounts loaded',
        {
          noOfAccounts: lengthOfSnapshot,
          newActivedAccountPairs:
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
          latestSerializedAccountSnaphotByKeyringId[keyringAccountId] ?? null;
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
          latestStateSnapshotSerialized,
          unresolvedSep41AssetIds,
        );

        const { balanceChanges, assetListChanges } =
          this.#diffFullSnapshotsForKeyring(
            stateSnapshotOnChainAccount,
            synchronizedOnChainAccount,
          );

        if (balanceChanges !== null) {
          balancesPayload ??= {};
          balancesPayload[keyringAccountId] = balanceChanges;
          this.#logger.debug(
            'Differences in full snapshots for keyring account - balanceChanges',
            {
              keyringAccountId,
              balanceChangesLength: Object.keys(balanceChanges).length,
            },
          );
        }
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

      // 6. Emit the keyring events if the balances or the non-native asset list changed.
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
   * @param stellarAccountIds - Stellar account ids to query in one batch call.
   * @param scope - Network to query.
   * @returns Shared SEP-41 inputs consumed in the main synchronize loop.
   */
  async #synchronizeSep41AssetBalances(
    stellarAccountIds: string[],
    scope: KnownCaip2ChainId,
  ): Promise<Sep41BalanceFetchResult> {
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

    this.#logger.debug('SEP-41 assets to query balances for', {
      noOfAssets: sep41Assets.length,
    });

    const assetIds: KnownCaip19Sep41AssetId[] = [];
    const sep41AssetSymbols = sep41Assets.reduce<
      Record<KnownCaip19Sep41AssetId, string>
    >((acc, asset) => {
      const assetId = asset.assetId as KnownCaip19Sep41AssetId;
      acc[assetId] = asset.symbol;
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
      symbolsByAssetId: sep41AssetSymbols,
      balancesByAccountId: sep41AssetBalancesByAccount,
    };
  }

  /**
   * Applies fetched SEP-41 balances for one account and returns unresolved token ids.
   *
   * Returning `undefined` means the whole SEP-41 fetch step failed; merge will copy any missing
   * persisted SEP-41 rows. Returning a set means the fetch step succeeded and merge should only
   * restore rows for token ids still unresolved here.
   *
   * @param onChainAccount - In-memory account after classic Horizon load; receives nonzero SEP-41 rows.
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
    // Missing address entry: batch result had no map for this account (often an empty overall result). Not a throw — the call still resolved.
    const sep41AssetBalances =
      sep41BalanceFetchResult.balancesByAccountId[onChainAccount.accountId] ??
      {};
    for (const assetId of sep41BalanceFetchResult.assetIds) {
      const balance = sep41AssetBalances[assetId];
      if (!sep41BalanceFetchResult.symbolsByAssetId[assetId]) {
        continue;
      }
      // No balance value for this SEP-41 token — mark unresolved so the merge step can reuse the last snapshot row.
      if (balance === null || balance === undefined) {
        unresolvedSep41AssetIds.add(assetId);
        continue;
      }
      // Balance is zero — user does not hold this SEP-41 token; do not add a row (merge will not revive it when the step succeeded).
      if (balance.isZero()) {
        continue;
      }
      onChainAccount.setSep41Asset(assetId, {
        balance,
        symbol: sep41BalanceFetchResult.symbolsByAssetId[assetId],
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
    persisted: OnChainAccountSerializableFull | null,
    unresolvedSep41AssetIds?: Set<KnownCaip19Sep41AssetId>,
  ): OnChainAccount {
    if (!persisted) {
      return current;
    }

    for (const row of persisted.balances) {
      const { assetId } = row;
      if (!isSep41Id(assetId) || current.hasAsset(assetId)) {
        continue;
      }

      // This SEP-41 token is still missing on `current` after the balance step — restore the last saved row when allowed above.
      if (
        unresolvedSep41AssetIds === undefined ||
        unresolvedSep41AssetIds.has(assetId)
      ) {
        current.setSep41Asset(assetId, {
          balance: new BigNumber(row.balance),
          symbol: row.symbol,
        });
      }
    }

    return current;
  }

  /**
   * Builds keyring event deltas:
   * - `stateSnapshotOnChainAccount`: rehydrated account from the latest serialized state snapshot.
   * - `synchronizedOnChainAccount`: in-memory account after merge (matches what was just serialized to state).
   *
   * @param stateSnapshotOnChainAccount - Latest account from state (`null` on first sync for this id/scope).
   * @param synchronizedOnChainAccount - Bound account after Horizon + SEP-41 + merge.
   * @returns Nullable payloads for balance and non-native asset-list deltas.
   */
  #diffFullSnapshotsForKeyring(
    stateSnapshotOnChainAccount: OnChainAccount | null,
    synchronizedOnChainAccount: OnChainAccount,
  ): {
    balanceChanges: Record<string, { unit: string; amount: string }> | null;
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
      const latestStateBalance =
        latestStateRow === undefined
          ? undefined
          : latestStateRow.balance.toString();
      const currentBalance =
        currentRow === undefined ? undefined : currentRow.balance.toString();

      if (latestStateBalance !== currentBalance) {
        balanceChanges[assetId as string] = {
          unit: currentRow?.symbol ?? latestStateRow?.symbol ?? '',
          amount: currentBalance ?? '0',
        };
      }

      if (assetId === nativeAssetId) {
        continue;
      }
      if (
        synchronizedOnChainAccount.hasAsset(assetId) &&
        !stateSnapshotOnChainAccount?.hasAsset(assetId)
      ) {
        addedAssets.push(assetId);
      }
      if (
        stateSnapshotOnChainAccount?.hasAsset(assetId) &&
        !synchronizedOnChainAccount.hasAsset(assetId)
      ) {
        removedAssets.push(assetId);
      }
    }

    return {
      balanceChanges:
        Object.keys(balanceChanges).length > 0 ? balanceChanges : null,
      assetListChanges:
        addedAssets.length > 0 || removedAssets.length > 0
          ? {
              added: addedAssets,
              removed: removedAssets,
            }
          : null,
    };
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
