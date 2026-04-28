import { cloneDeep } from 'lodash';

import type {
  AssetMetadataByAssetId,
  AssetMetadataState,
  StellarAssetMetadata,
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

  /**
   * Returns persisted asset for the given asset ID.
   *
   * @param assetId - The asset ID to look up.
   * @returns A Promise that resolves to the persisted asset if found, otherwise `null`.
   */
  async getByAssetId(
    assetId: KnownCaip19AssetId,
  ): Promise<StellarAssetMetadata | null> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};
    return assets[assetId] ?? null;
  }

  /**
   * Returns persisted assets for the given IDs, shaped like `AssetMetadataState.assets`.
   * Only keys present in storage are included; missing IDs are omitted.
   *
   * @param assetIds - The asset IDs to look up.
   * @returns A Promise that resolves to the subset of the persisted `assets` map for those IDs.
   */
  async getByAssetIds(
    assetIds: KnownCaip19AssetId[],
  ): Promise<StellarAssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    const result: StellarAssetMetadata[] = [];

    for (const assetId of assetIds) {
      const asset = assets[assetId];
      if (asset !== undefined) {
        result.push(asset);
      }
    }
    return result;
  }

  /**
   * Returns all persisted assets.
   *
   * @returns A Promise that resolves to all persisted assets.
   */
  async getAll(): Promise<StellarAssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    return Object.values(assets).filter(
      (row): row is StellarAssetMetadata => row !== undefined,
    );
  }

  /**
   * Returns all persisted assets for the given scope.
   *
   * @param scope - The chain ID to look up.
   * @returns A Promise that resolves to all persisted assets for the given scope.
   */
  async getAllByScope(
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    return Object.values(assets).filter(
      (asset): asset is StellarAssetMetadata =>
        asset !== undefined && asset.chainId === scope,
    );
  }

  /**
   * Returns persisted assets for the given asset type and chain ID.
   *
   * @param assetType - The asset type to look up.
   * @param scope - The chain ID to look up.
   * @returns A Promise that resolves to the persisted assets for the given asset type and chain ID.
   */
  async getByAssetType(
    assetType: AssetType,
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    const assets =
      (await this.#state.getKey<AssetMetadataByAssetId>(this.#stateKey)) ?? {};

    return Object.values(assets).filter(
      (asset): asset is StellarAssetMetadata =>
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
  async saveMany(assets: StellarAssetMetadata[]): Promise<void> {
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
