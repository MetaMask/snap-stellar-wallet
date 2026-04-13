import { assert } from '@metamask/superstruct';
import { parseCaipAssetType } from '@metamask/utils';

import type { AssetMetadata, AssetMetadataByAssetId } from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataServiceException } from './exceptions';
import type {
  KnownCaip19AssetId,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
  KnownCaip19Slip44Id,
} from '../../api';
import { AssetType, KnownCaip2ChainIdStruct } from '../../api';
import {
  STELLAR_DECIMAL_PLACES,
  NATIVE_ASSET_SYMBOL,
  NATIVE_ASSET_NAME,
} from '../../constants';
import {
  createPrefixedLogger,
  isClassicAssetId,
  isSep41Id,
  isSlip44Id,
  batchesAllSettled,
  parseClassicAssetCodeIssuer,
} from '../../utils';
import type { ILogger } from '../../utils';
import type { AssetDataResponse, NetworkService } from '../network';
import { TokenApiClient } from './token-api/TokenApiClient';
import { getIconUrl } from './utils';

/**
 * Source row for building {@link AssetMetadata}: {@link AssetDataResponse} from the network (including
 * {@link NetworkService.getAssetData} / batch RPC), or a synthetic native (slip44) descriptor
 * that does not come from a token contract ledger entry.
 */
type AssetMetadataBuildSource =
  | AssetDataResponse
  | {
      assetId: KnownCaip19Slip44Id;
      decimals: number;
      symbol: string;
      name?: string;
    };

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
    this.#tokenApiClient = new TokenApiClient();
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
  }): Promise<AssetMetadata> {
    const { assetId } = params;

    if (isSep41Id(assetId)) {
      const assets = await this.#getAssetsMetadataByAssetIds([assetId]);
      const found = assets.find((asset) => asset.assetId === assetId);
      if (!found) {
        throw new AssetMetadataServiceException(
          `Asset metadata not found for asset id: ${assetId}`,
        );
      }
      return found;
    } else if (isSlip44Id(assetId)) {
      return this.#getNativeAssetMetadata(assetId);
    } else if (isClassicAssetId(assetId)) {
      const { assetReference } = parseCaipAssetType(assetId);
      const { assetCode } = parseClassicAssetCodeIssuer(assetReference);
      return this.#toAssetMetadata({
        assetId,
        decimals: STELLAR_DECIMAL_PLACES,
        symbol: assetCode,
        name: assetCode,
      });
    }
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new AssetMetadataServiceException(`Invalid asset id: ${assetId}`);
  }

  async getAssetsMetadataByAssetIds(
    assetIds: KnownCaip19AssetId[],
  ): Promise<AssetMetadataByAssetId> {
    const list = await this.#getAssetsMetadataByAssetIds(assetIds);
    return list.reduce<AssetMetadataByAssetId>((acc, asset) => {
      acc[asset.assetId] = asset;
      return acc;
    }, {});
  }

  async getAllSep41AssetsMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<AssetMetadata[]> {
    const persistedAssets = await this.#assetMetadataRepository.getByAssetType(
      AssetType.Sep41,
      scope,
    );

    if (persistedAssets.length > 0) {
      return persistedAssets;
    }

    const tokensMetadata =
      await this.#tokenApiClient.getAllTokensMetadata(scope);

    await this.#assetMetadataRepository.saveMany(tokensMetadata);

    return tokensMetadata;
  }

  async synchronize(scope: KnownCaip2ChainId): Promise<void> {
    const tokensMetadata =
      await this.#tokenApiClient.getAllTokensMetadata(scope);
    await this.#assetMetadataRepository.saveMany(tokensMetadata);
  }

  async #getAssetsMetadataByAssetIds(
    assetIds: KnownCaip19AssetId[],
  ): Promise<AssetMetadata[]> {
    const uniqueAssetIds = Array.from(new Set(assetIds));

    const { assets, missingAssetIds } =
      await this.#getPersistedMetadata(uniqueAssetIds);

    if (missingAssetIds.length === 0) {
      return assets;
    }

    const fetchedAssets =
      await this.#fetchMissingAssetsMetadata(missingAssetIds);

    if (fetchedAssets.length > 0) {
      await this.#assetMetadataRepository.saveMany(fetchedAssets);
    }

    return assets.concat(fetchedAssets);
  }

  async #getPersistedMetadata(assetIds: KnownCaip19AssetId[]): Promise<{
    assets: AssetMetadata[];
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
  ): Promise<AssetMetadata[]> {
    const { assets: apiTokenAssets, missingAssetIds } =
      await this.#fetchTokenAssetsFromApi(assetIds);

    const rpcTokenAssets = await this.#fetchTokenAssetsFromRpc(missingAssetIds);

    return apiTokenAssets.concat(rpcTokenAssets);
  }

  async #fetchTokenAssetsFromApi(assetIds: KnownCaip19AssetId[]): Promise<{
    assets: AssetMetadata[];
    missingAssetIds: KnownCaip19AssetId[];
  }> {
    const tokensMetadata =
      await this.#tokenApiClient.getTokensMetadata(assetIds);
    const { hits: assets, missing: missingAssetIds } =
      this.#partitionHitsAndMissingByArray(assetIds, tokensMetadata);

    return { assets, missingAssetIds };
  }

  async #fetchTokenAssetsFromRpc(
    assetIds: KnownCaip19AssetId[],
  ): Promise<AssetMetadata[]> {
    const assets: AssetMetadata[] = [];
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

      assets.push(this.#toAssetMetadata(promiseEntry.value));
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

  #toAssetMetadata(assetData: AssetMetadataBuildSource): AssetMetadata {
    const name = assetData.name ?? assetData.symbol;
    const { assetNamespace, chainId } = parseCaipAssetType(assetData.assetId);

    return {
      assetId: assetData.assetId,
      name,
      symbol: assetData.symbol,
      chainId: chainId as KnownCaip2ChainId,
      assetType: assetNamespace as AssetType,
      fungible: true,
      iconUrl: getIconUrl(assetData.assetId),
      units: [
        {
          name,
          symbol: assetData.symbol,
          decimals: assetData.decimals,
        },
      ],
    };
  }

  #getNativeAssetMetadata(assetId: KnownCaip19Slip44Id): AssetMetadata {
    return this.#toAssetMetadata({
      assetId,
      decimals: STELLAR_DECIMAL_PLACES,
      symbol: NATIVE_ASSET_SYMBOL,
      name: NATIVE_ASSET_NAME,
    });
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
