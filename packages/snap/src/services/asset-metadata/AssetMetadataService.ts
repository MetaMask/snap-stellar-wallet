import type { AssetMetadata } from '@metamask/snaps-sdk';
import { ensureError, parseCaipAssetType } from '@metamask/utils';

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
  isSlip44Id,
} from '../../utils';
import type { ILogger } from '../../utils';
import type { NetworkService } from '../network';
import type { StellarAssetMetadata } from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataServiceException } from './exceptions';
import { TokenApiClient } from './token-api/TokenApiClient';
import { getNativeAssetMetadata, toStellarAssetMetadata } from './utils';

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
   * @param params - Resolution input.
   * @param params.assetId - Native, classic, or SEP-41 CAIP-19 asset id.
   * @param params.scope - CAIP-2 chain id.
   * @returns Resolved asset data for wallet / transaction use.
   */
  async resolve(params: {
    assetId: KnownCaip19AssetIdOrSlip44Id;
    scope: KnownCaip2ChainId;
  }): Promise<StellarAssetMetadata> {
    const { assetId, scope } = params;
    const assets = await this.#fetchAndPersistAssetsByAssetIds(
      [assetId],
      scope,
    );
    const found = assets.find((asset) => asset.assetId === assetId);
    if (!found) {
      throw new AssetMetadataServiceException(
        `Asset metadata not found for asset id: ${assetId}`,
      );
    }
    return found;
  }

  /**
   * Returns all assets for the given asset IDs.
   *
   * @param assetIds - The asset IDs to look up.
   * @param scope - The chain ID to look up.
   * @returns A Promise that resolves to all assets metadata for the given asset IDs.
   */
  async getAssetsMetadataByAssetIds(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
    scope: KnownCaip2ChainId,
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, AssetMetadata | null>> {
    this.#logger.debug('Fetching assets metadata by asset ids', { assetIds });

    const list = await this.#fetchAndPersistAssetsByAssetIds(assetIds, scope);

    const metadataByAssetId = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AssetMetadata | null
    >;

    for (const assetId of assetIds) {
      metadataByAssetId[assetId] = null;
    }

    for (const asset of list) {
      metadataByAssetId[asset.assetId] = this.#toAssetMetadata(asset);
    }

    return metadataByAssetId;
  }

  /**
   * Returns all persisted SEP-41 assets for the given chain ID.
   *
   * @param scope - The chain ID to look up.
   * @returns A Promise that resolves to all persisted SEP-41 assets for the given chain ID.
   */
  async getAllSep41AssetsMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    const persistedAssets = await this.#assetMetadataRepository.getByAssetType(
      AssetType.Sep41,
      scope,
    );

    return persistedAssets;
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
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    const uniqueAssetIds = new Set<KnownCaip19AssetIdOrSlip44Id>(assetIds);
    const result: StellarAssetMetadata[] = [];
    const stellarAssetIds: KnownCaip19AssetId[] = [];

    for (const assetId of Array.from(uniqueAssetIds)) {
      // make sure we only fetch assets for the given scope
      const { chainId } = parseCaipAssetType(assetId);
      if ((chainId as KnownCaip2ChainId) !== scope) {
        continue;
      }

      if (isSlip44Id(assetId)) {
        result.push(getNativeAssetMetadata(scope));
      } else {
        stellarAssetIds.push(assetId);
      }
    }

    const { assets, missingAssetIds } =
      await this.#getPersistedAssetMetadata(stellarAssetIds);

    if (missingAssetIds.length === 0) {
      return result.concat(assets);
    }

    const fetchedAssets = await this.#fetchMissingAssetsMetadata(
      missingAssetIds,
      scope,
    );

    if (fetchedAssets.length > 0) {
      await this.#assetMetadataRepository.saveMany(fetchedAssets);
    }

    return result.concat(assets, fetchedAssets);
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

    const sepTokenAssets = await this.#fetchSepTokenAssets(
      missingSep41AssetIds,
      scope,
    );
    const classicTokenAssets = await this.#fetchClassicTokenAssets(
      missingClassicAssetIds,
      scope,
    );
    return apiTokenAssets.concat(sepTokenAssets).concat(classicTokenAssets);
  }

  async #fetchTokenAssetsFromApi(assetIds: KnownCaip19AssetId[]): Promise<{
    assets: StellarAssetMetadata[];
    missingAssetIds: KnownCaip19AssetId[];
  }> {
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
    this.#logger.debug('Fetching SEP-41 token assets from RPC', { assetIds });
    const assets: StellarAssetMetadata[] = [];
    const missingTokenAssetIds = new Set<string>(assetIds);

    const settled = await batchesAllSettledWithChunks(
      assetIds,
      this.#sepAssetChunkSize,
      this.#sepAssetBatchSize,
      async (chunk) => this.#networkService.getAssetsData(chunk, scope),
    );

    for (const entry of settled) {
      if (entry.status === 'rejected') {
        this.#logger.logErrorWithDetails(
          'Error fetching SEP-41 token assets from RPC',
          ensureError(entry.reason).message,
        );
        continue;
      }
      for (const asset of entry.value) {
        assets.push(toStellarAssetMetadata(asset));
        missingTokenAssetIds.delete(asset.assetId);
      }
    }

    if (missingTokenAssetIds.size > 0) {
      this.#logger.warn(
        `Failed to fetch token metadata for assets: ${Array.from(missingTokenAssetIds).join(', ')}`,
      );
    }

    return assets;
  }

  async #fetchClassicTokenAssets(
    assetIds: KnownCaip19ClassicAssetId[],
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    this.#logger.debug('Fetching Classic token assets from Horizon', {
      assetIds,
    });
    const assets: StellarAssetMetadata[] = [];
    const missingTokenAssetIds = new Set<string>(assetIds);

    const settled = await batchesAllSettled(
      assetIds,
      this.#classicAssetBatchSize,
      async (assetId) =>
        this.#networkService.getClassicAssetData(assetId, scope),
    );

    for (const entry of settled) {
      if (entry.status === 'rejected') {
        this.#logger.logErrorWithDetails(
          'Error fetching Classic token assets from Horizon',
          ensureError(entry.reason).message,
        );
        continue;
      }
      assets.push(toStellarAssetMetadata(entry.value));
      missingTokenAssetIds.delete(entry.value.assetId);
    }

    if (missingTokenAssetIds.size > 0) {
      this.#logger.warn(
        `Failed to fetch token metadata for assets: ${Array.from(missingTokenAssetIds).join(', ')}`,
      );
    }

    return assets;
  }

  #toAssetMetadata(assetData: StellarAssetMetadata): AssetMetadata {
    return {
      fungible: assetData.fungible,
      iconUrl: assetData.iconUrl,
      units: assetData.units,
      symbol: assetData.symbol,
      name: assetData.name,
    };
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
