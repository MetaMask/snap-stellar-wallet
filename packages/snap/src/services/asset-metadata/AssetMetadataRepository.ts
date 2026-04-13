import { cloneDeep } from 'lodash';

import type {
  AssetMetadataByAssetId,
  AssetMetadataState,
  AssetMetadata,
} from './api';
import type {
  AssetType,
  KnownCaip19AssetId,
  KnownCaip2ChainId,
} from '../../api';
import type { IStateManager } from '../state/IStateManager';

export class AssetMetadataRepository {
  readonly #state: IStateManager<AssetMetadataState>;

  readonly #stateKey = 'assets';

  constructor(state: IStateManager<AssetMetadataState>) {
    this.#state = state;
  }

  async getByAssetId(
    assetId: KnownCaip19AssetId,
  ): Promise<AssetMetadata | null> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};
    return assets[assetId] ?? null;
  }

  /**
   * Returns cached assets for the given IDs, shaped like `AssetMetadataState.assets`.
   * Only keys present in storage are included; missing IDs are omitted.
   *
   * @param assetIds - The asset IDs to look up.
   * @returns Subset of the persisted `assets` map for those IDs.
   */
  async getByAssetIds(
    assetIds: KnownCaip19AssetId[],
  ): Promise<AssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    const result: AssetMetadata[] = [];

    for (const assetId of assetIds) {
      const asset = assets[assetId];
      if (asset !== undefined) {
        result.push(asset);
      }
    }
    return result;
  }

  async getAll(): Promise<AssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    return Object.values(assets).filter(
      (row): row is AssetMetadata => row !== undefined,
    );
  }

  async getByAssetType(
    assetType: AssetType,
    scope: KnownCaip2ChainId,
  ): Promise<AssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    return Object.values(assets).filter(
      (asset): asset is AssetMetadata =>
        asset !== undefined &&
        asset.assetType === assetType &&
        asset.chainId === scope,
    );
  }

  /**
   * Upserts rows by `assetId`. Stamps `persistedAt` (same value for all rows in this call)
   * for future staleness / TTL logic.
   *
   * @param assets - Full metadata rows; `assetId` must match the CAIP-19 key for that network.
   */
  async saveMany(assets: AssetMetadata[]): Promise<void> {
    if (assets.length === 0) {
      return;
    }
    const persistedAt = Date.now();
    await this.#state.update((stateValue) => {
      const newState = cloneDeep(stateValue);

      for (const asset of assets) {
        newState.assets[asset.assetId] = {
          ...asset,
          persistedAt,
        };
      }
      return newState;
    });
  }
}
