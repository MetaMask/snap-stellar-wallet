import type { AssetMetadata } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { parseCaipAssetType } from '@metamask/utils';

import type {
  KnownCaip19AssetId,
  KnownCaip19AssetIdOrSlip44Id,
} from '../../api';
import {
  KnownCaip2ChainId,
  AssetType,
  KnownCaip2ChainIdStruct,
} from '../../api';
import { AppConfig } from '../../config';
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import {
  batchesAllSettled,
  createPrefixedLogger,
  isSep41Id,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
} from '../../utils';
import type { ILogger } from '../../utils';
import type { AssetDataResponse, NetworkService } from '../network';
import type { StellarAssetMetadata } from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataServiceException } from './exceptions';
import { TokenApiClient } from './token-api/TokenApiClient';
import {
  getIconUrl,
  getNativeAssetMetadata,
  toStellarAssetMetadata,
} from './utils';

/**
 * Resolves CAIP-19 asset identifiers and caches fungible asset metadata for lookups.
 */
export class AssetMetadataService {
  static readonly #rpcBackfillBatchSize = 5;

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
    const { assetId } = params;

    if (AppConfig.selectedNetwork === KnownCaip2ChainId.Testnet) {
      if (isSlip44Id(assetId)) {
        return getNativeAssetMetadata(assetId);
      }
      const { assetNamespace, chainId, assetReference } =
        parseCaipAssetType(assetId);
      const { assetCode } = parseClassicAssetCodeIssuer(assetReference);
      return {
        assetId,
        name: assetCode,
        symbol: assetCode,
        chainId: chainId as KnownCaip2ChainId,
        assetType: assetNamespace as AssetType,
        fungible: true,
        iconUrl: getIconUrl(assetId),
        units: [
          {
            name: assetCode,
            symbol: assetCode,
            decimals: STELLAR_DECIMAL_PLACES,
          },
        ],
      };
    }

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
   * Returns all assets for the given asset IDs.
   *
   * @param assetIds - The asset IDs to look up.
   * @returns A Promise that resolves to all assets metadata for the given asset IDs.
   */
  async getAssetsMetadataByAssetIds(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, AssetMetadata | null>> {
    this.#logger.debug('Fetching assets metadata by asset ids', { assetIds });
    const list = await this.#fetchAndPersistAssetsByAssetIds(assetIds);

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
  ): Promise<StellarAssetMetadata[]> {
    const result: StellarAssetMetadata[] = [];
    const stellarAssetIds: KnownCaip19AssetId[] = [];
    const deduplicatedAssetIds = new Set<KnownCaip19AssetId>();
    for (const assetId of assetIds) {
      if (isSlip44Id(assetId)) {
        result.push(getNativeAssetMetadata(assetId));
      } else {
        if (!deduplicatedAssetIds.has(assetId)) {
          stellarAssetIds.push(assetId);
        }
        deduplicatedAssetIds.add(assetId);
      }
    }

    const { assets, missingAssetIds } =
      await this.#getPersistedAssetMetadata(stellarAssetIds);

    if (missingAssetIds.length === 0) {
      return result.concat(assets);
    }

    const fetchedAssets =
      await this.#fetchMissingAssetsMetadata(missingAssetIds);

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
  ): Promise<StellarAssetMetadata[]> {
    const { assets: apiTokenAssets, missingAssetIds } =
      await this.#fetchTokenAssetsFromApi(assetIds);

    const rpcTokenAssets = await this.#fetchTokenAssetsFromRpc(missingAssetIds);

    return apiTokenAssets.concat(rpcTokenAssets);
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

  async #fetchTokenAssetsFromRpc(
    assetIds: KnownCaip19AssetId[],
  ): Promise<StellarAssetMetadata[]> {
    this.#logger.debug('Fetching token assets from RPC', { assetIds });
    const assets: StellarAssetMetadata[] = [];
    const missingTokenAssetIds = new Set<KnownCaip19AssetId>(assetIds);

    const settled = await batchesAllSettled(
      assetIds,
      AssetMetadataService.#rpcBackfillBatchSize,
      async (assetId) => this.#fetchTokenAssetFromRpc(assetId),
    );

    for (let index = 0; index < assetIds.length; index += 1) {
      const assetId = assetIds[index];
      const promiseEntry = settled[index];

      if (assetId === undefined || promiseEntry?.status !== 'fulfilled') {
        continue;
      }

      assets.push(toStellarAssetMetadata(promiseEntry.value));
      missingTokenAssetIds.delete(assetId);
    }

    if (missingTokenAssetIds.size > 0) {
      this.#logger.warn(
        `Failed to fetch token metadata for assets: ${Array.from(missingTokenAssetIds).join(', ')}`,
      );
    }

    return assets;
  }

  async #fetchTokenAssetFromRpc(
    assetId: KnownCaip19AssetId,
  ): Promise<AssetDataResponse> {
    const scope = parseCaipAssetType(assetId).chainId;
    assert(scope, KnownCaip2ChainIdStruct);
    if (isSep41Id(assetId)) {
      return this.#networkService.getAssetData(assetId, scope);
    }
    throw new AssetMetadataServiceException(`Invalid asset id: ${assetId}`);
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
