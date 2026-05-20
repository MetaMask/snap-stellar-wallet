import { cloneDeep } from 'lodash';

import type {
  OnChainAccountSnapshotsByKeyringId,
  OnChainAccountState,
} from './api';
import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import type { KnownCaip2ChainId } from '../../api';
import type { IStateManager } from '../state/IStateManager';

export class OnChainAccountRepository {
  readonly #state: IStateManager<OnChainAccountState>;

  readonly #stateKey = 'onChainAccounts';

  constructor(state: IStateManager<OnChainAccountState>) {
    this.#state = state;
  }

  /**
   * Find the on-chain account for the given keyring account id from the State.
   *
   * @param keyringAccountId - MetaMask keyring account id (not the Stellar G-address).
   * @param scope - CAIP-2 chain id for the cached snapshot.
   * @returns The stored snapshot, or `null` when none exists for this keyring id and scope.
   */
  async findByKeyringAccountId(
    keyringAccountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccountSerializableFull | null> {
    const snapshotsByAccountId = await this.findByKeyringAccountIds(
      [keyringAccountId],
      scope,
    );

    return snapshotsByAccountId[keyringAccountId] ?? null;
  }

  /**
   * Find the on-chain accounts for the given keyring account ids from the State.
   *
   * @param keyringAccountIds - MetaMask keyring account ids (not Stellar G-addresses).
   * @param scope - CAIP-2 chain id for the cached snapshots.
   * @returns Account id -> snapshot (or `null` when missing for the given scope).
   */
  async findByKeyringAccountIds(
    keyringAccountIds: string[],
    scope: KnownCaip2ChainId,
  ): Promise<Record<string, OnChainAccountSerializableFull | null>> {
    const byKeyring =
      (await this.#state.getKey<OnChainAccountSnapshotsByKeyringId>(
        this.#stateKey,
      )) ?? {};
    const snapshotsByAccountId: Record<
      string,
      OnChainAccountSerializableFull | null
    > = {};

    for (const keyringAccountId of keyringAccountIds) {
      snapshotsByAccountId[keyringAccountId] =
        byKeyring[keyringAccountId]?.[scope] ?? null;
    }

    return snapshotsByAccountId;
  }

  /**
   * Persists one snapshot under `onChainAccounts[keyringId][account.scope]` in a single atomic
   * `snap_manageState` update (avoids races between separate get/set paths).
   *
   * @param keyringAccountId - MetaMask keyring account id (not the Stellar G-address).
   * @param account - Serializable snapshot; `account.scope` selects the nested key.
   */
  async save(
    keyringAccountId: string,
    account: OnChainAccountSerializableFull,
  ): Promise<void> {
    await this.#state.update((state) => {
      const newState = cloneDeep(state);
      if (!newState[this.#stateKey]) {
        newState[this.#stateKey] = {} as OnChainAccountSnapshotsByKeyringId;
      }
      const root = newState[this.#stateKey];
      root[keyringAccountId] ??= {};
      root[keyringAccountId][account.scope] = account;
      return newState;
    });
  }

  /**
   * Writes accounts in one atomic `IStateManager.update` (full state blob). Callers that read then
   * merge outside this method should serialize those steps if updates can overlap (see
   * `OnChainAccountSynchronizeService` mutex).
   *
   * @param accounts - Map of keyring account id → snapshot for `accounts[id].scope`.
   */
  async saveMany(
    accounts: Record<string, OnChainAccountSerializableFull>,
  ): Promise<void> {
    if (Object.keys(accounts).length === 0) {
      return;
    }

    await this.#state.update((state) => {
      const newState = cloneDeep(state);
      if (!newState[this.#stateKey]) {
        newState[this.#stateKey] = {} as OnChainAccountSnapshotsByKeyringId;
      }
      const accountsByKeyringId = newState[this.#stateKey];

      for (const [keyringAccountId, account] of Object.entries(accounts)) {
        accountsByKeyringId[keyringAccountId] ??= {};
        accountsByKeyringId[keyringAccountId][account.scope] = account;
      }
      return newState;
    });
  }
}
