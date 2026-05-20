import { ensureError } from '@metamask/utils';

import type {
  KnownCaip19AssetId,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
} from '../../api';
import { KnownCaip2ChainId, AssetType } from '../../api';
import { AppConfig } from '../../config';
import {
  batchesAllSettled,
  batchesAllSettledWithChunks,
  createPrefixedLogger,
  isClassicAssetId,
  isSep41Id,
} from '../../utils';
import type { ILogger } from '../../utils';
import type { AssetDataResponse, NetworkService } from '../network';
import type {
  KeyringAssetMetadataByAssetId,
  StellarAssetMetadata,
} from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataServiceException } from './exceptions';
import { TokenApiClient } from './token-api/TokenApiClient';
import {
  getNativeAssetMetadata,
  groupAssetsByChainId,
  toKeyringAssetMetadata,
  toStellarAssetMetadata,
} from './utils';

/**
 * Resolves CAIP-19 asset identifiers and caches fungible asset metadata for lookups.
 */
export class AssetMetadataService {
  // Batch sizes for fetching assets from RPC, it is lower because we can fetch multiple assets at once
  readonly #sepAssetBatchSize = 5;

  // Chunk size for fetching SEP-41 assets from RPC
  readonly #sepAssetChunkSize = 10;

  // Batch sizes for fetching assets from Horizon
  readonly #classicAssetBatchSize = 10;

  readonly #networkService: NetworkService;

  readonly #tokenApiClient: TokenApiClient;

  readonly #assetMetadataRepository: AssetMetadataRepository;

  readonly #logger: ILogger;

  constructor({
    networkService,
    assetMetadataRepository,
    logger,
  }: {
    networkService: NetworkService;
    assetMetadataRepository: AssetMetadataRepository;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#tokenApiClient = new TokenApiClient(
      {
        baseUrl: AppConfig.api.tokenApi.baseUrl,
        chunkSize: AppConfig.api.tokenApi.chunkSize,
      },
      logger,
    );
    this.#assetMetadataRepository = assetMetadataRepository;
    this.#logger = createPrefixedLogger(logger, '[🪙 AssetMetadataService]');
  }

  /**
   * Loads decimals for the asset; for SEP-41, fetches symbol and contract metadata from the token contract.
   *
   * @param assetId - Native, classic, or SEP-41 CAIP-19 asset id.
   * @returns Resolved asset data for wallet / transaction use.
   */
  async resolve(
    assetId: KnownCaip19AssetIdOrSlip44Id,
  ): Promise<StellarAssetMetadata> {
    const assets = await this.#fetchAndPersistAssetsByAssetIds([assetId]);
    const found = assets.find((asset) => asset.assetId === assetId);
    if (!found) {
      throw new AssetMetadataServiceException(
        `Asset metadata not found for asset id: ${assetId}`,
      );
    }
    return found;
  }

  /**
   * Returns all assets in keyring format for the given asset IDs.
   *
   * @param assetIds - The asset IDs to look up.
   * @returns A Promise that resolves to all assets metadata for the given asset IDs.
   */
  async getAssetsMetadataByAssetIds(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<KeyringAssetMetadataByAssetId> {
    this.#logger.debug('Fetching assets metadata by asset ids', { assetIds });

    const metadataByAssetId = {} as KeyringAssetMetadataByAssetId;

    const list = await this.#fetchAndPersistAssetsByAssetIds(assetIds);

    for (const assetId of assetIds) {
      metadataByAssetId[assetId] = null;
    }

    for (const asset of list) {
      metadataByAssetId[asset.assetId] = toKeyringAssetMetadata(asset);
    }

    return metadataByAssetId;
  }

  /**
   * Returns all persisted SEP-41 assets for the given chain ID.
   *
   * @param scope - The chain ID to look up.
   * @returns A Promise that resolves to all persisted SEP-41 assets for the given chain ID.
   */
  async getPersistedSep41AssetsMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    const persistedAssets = await this.#assetMetadataRepository.getByAssetType(
      AssetType.Sep41,
      scope,
    );

    return persistedAssets;
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
    return this.#assetMetadataRepository.getAllByScope(scope);
  }

  /**
   * Fetches and persists all Assets for the given chain ID from the token API.
   *
   * @param scope - The chain ID to fetch and persist assets for.
   */
  async synchronize(scope: KnownCaip2ChainId): Promise<void> {
    const tokensMetadata =
      await this.#tokenApiClient.getAllTokensMetadata(scope);
    await this.#assetMetadataRepository.saveMany(tokensMetadata);
  }

  async #fetchAndPersistAssetsByAssetIds(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<StellarAssetMetadata[]> {
    const { nativeAssets: nativeAssetsByChainId, assets: assetsByChainId } =
      groupAssetsByChainId(assetIds);
    const result: StellarAssetMetadata[] = [];
    // fetch native assets
    for (const [chainId] of nativeAssetsByChainId) {
      result.push(getNativeAssetMetadata(chainId));
    }

    // fetch assets from state
    const allNonNativeAssetIds = [...assetsByChainId.values()].flat();
    const { assets, missingAssetIds } =
      await this.#getPersistedAssetMetadata(allNonNativeAssetIds);

    if (missingAssetIds.length === 0) {
      return result.concat(assets);
    }

    // fetch missing assets by chain id
    const missingAssets: StellarAssetMetadata[] = [];
    const { assets: missingAssetIdsByChainId } =
      groupAssetsByChainId(missingAssetIds);

    for (const [chainId, chainAssetIds] of missingAssetIdsByChainId) {
      const fetchedAssets = await this.#fetchMissingAssetsMetadata(
        chainAssetIds,
        chainId,
      );
      missingAssets.push(...fetchedAssets);
    }

    // Backfill in state
    if (missingAssets.length > 0) {
      await this.#assetMetadataRepository.saveMany(missingAssets);
    }

    return result.concat(assets, missingAssets);
  }

  async #getPersistedAssetMetadata(assetIds: KnownCaip19AssetId[]): Promise<{
    assets: StellarAssetMetadata[];
    missingAssetIds: KnownCaip19AssetId[];
  }> {
    const cachedAssets =
      await this.#assetMetadataRepository.getByAssetIds(assetIds);
    const { hits: assets, missing: missingAssetIds } =
      this.#partitionHitsAndMissingByArray(assetIds, cachedAssets);

    return { assets, missingAssetIds };
  }

  async #fetchMissingAssetsMetadata(
    assetIds: KnownCaip19AssetId[],
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    let missingAssetIds: KnownCaip19AssetId[] = [];
    let apiTokenAssets: StellarAssetMetadata[] = [];

    if (scope === KnownCaip2ChainId.Mainnet) {
      // No scope required for the token API, as it only supports mainnet
      const apiResult = await this.#fetchTokenAssetsFromApi(assetIds);
      apiTokenAssets = apiResult.assets;
      missingAssetIds = apiResult.missingAssetIds;
    } else {
      missingAssetIds = assetIds;
    }

    const missingSep41AssetIds: KnownCaip19Sep41AssetId[] = [];
    const missingClassicAssetIds: KnownCaip19ClassicAssetId[] = [];

    for (const assetId of missingAssetIds) {
      if (isSep41Id(assetId)) {
        missingSep41AssetIds.push(assetId);
      } else if (isClassicAssetId(assetId)) {
        missingClassicAssetIds.push(assetId);
      }
      // there is no other asset type that is not SEP-41 or classic
    }

    const [sepTokenAssets, classicTokenAssets] = await Promise.all([
      this.#fetchSepTokenAssets(missingSep41AssetIds, scope),
      this.#fetchClassicTokenAssets(missingClassicAssetIds, scope),
    ]);
    return [...apiTokenAssets, ...sepTokenAssets, ...classicTokenAssets];
  }

  async #fetchTokenAssetsFromApi(assetIds: KnownCaip19AssetId[]): Promise<{
    assets: StellarAssetMetadata[];
    missingAssetIds: KnownCaip19AssetId[];
  }> {
    if (assetIds.length === 0) {
      return { assets: [], missingAssetIds: [] };
    }

    this.#logger.debug('Fetching token assets from API', { assetIds });
    const tokensMetadata =
      await this.#tokenApiClient.getTokensMetadata(assetIds);
    const { hits: assets, missing: missingAssetIds } =
      this.#partitionHitsAndMissingByArray(assetIds, tokensMetadata);
    this.#logger.debug('Token assets from API', { missingAssetIds });
    return { assets, missingAssetIds };
  }

  async #fetchSepTokenAssets(
    assetIds: KnownCaip19Sep41AssetId[],
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    if (assetIds.length === 0) {
      return [];
    }

    this.#logger.debug('Fetching SEP-41 token assets from RPC', { assetIds });

    const settled = await batchesAllSettledWithChunks(
      assetIds,
      this.#sepAssetChunkSize,
      this.#sepAssetBatchSize,
      async (chunk) => this.#networkService.getAssetsData(chunk, scope),
    );

    const { assets, missingAssetIds } =
      this.#extractSuccessAndMissingFromSettled(settled, assetIds);

    if (missingAssetIds.length > 0) {
      this.#logger.warn(
        `Failed to fetch token metadata for assets: ${Array.from(missingAssetIds).join(', ')}`,
      );
    }

    return assets;
  }

  async #fetchClassicTokenAssets(
    assetIds: KnownCaip19ClassicAssetId[],
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    if (assetIds.length === 0) {
      return [];
    }

    this.#logger.debug('Fetching Classic token assets from Horizon', {
      assetIds,
    });

    const settled = await batchesAllSettled(
      assetIds,
      this.#classicAssetBatchSize,
      async (assetId) =>
        this.#networkService.getClassicAssetData(assetId, scope),
    );

    const { assets, missingAssetIds } =
      this.#extractSuccessAndMissingFromSettled(settled, assetIds);

    if (missingAssetIds.length > 0) {
      this.#logger.warn(
        `Failed to fetch token metadata for assets: ${Array.from(missingAssetIds).join(', ')}`,
      );
    }

    return assets;
  }

  #extractSuccessAndMissingFromSettled(
    settled: PromiseSettledResult<AssetDataResponse | AssetDataResponse[]>[],
    assetIds: KnownCaip19AssetId[],
  ): { assets: StellarAssetMetadata[]; missingAssetIds: string[] } {
    const assets: StellarAssetMetadata[] = [];
    const missingTokenAssetIds = new Set<string>(assetIds);

    for (const entry of settled) {
      if (entry.status === 'rejected') {
        this.#logger.logErrorWithDetails(
          'Error fetching assets',
          ensureError(entry.reason).message,
        );
        continue;
      }

      if (Array.isArray(entry.value)) {
        for (const asset of entry.value) {
          assets.push(toStellarAssetMetadata(asset));
          missingTokenAssetIds.delete(asset.assetId);
        }
      } else {
        assets.push(toStellarAssetMetadata(entry.value));
        missingTokenAssetIds.delete(entry.value.assetId);
      }
    }

    return { assets, missingAssetIds: Array.from(missingTokenAssetIds) };
  }

  /**
   * For each requested id in order: collect cached row if present, else mark missing.
   *
   * @param ids - Requested asset ids (order preserved for hits).
   * @param cachedRows - Rows from cache or token API (may omit some ids).
   * @returns Hits in `ids` order, plus ids with no matching row.
   */
  #partitionHitsAndMissingByArray<
    TId extends string,
    TValue extends { assetId: string },
  >(ids: TId[], cachedRows: TValue[]): { hits: TValue[]; missing: TId[] } {
    const byId = new Map(cachedRows.map((row) => [row.assetId, row]));
    const hits: TValue[] = [];
    const missing: TId[] = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) {
        missing.push(id);
      } else {
        hits.push(row);
      }
    }

    return { hits, missing };
  }
}
