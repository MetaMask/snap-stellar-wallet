import { parseCaipAssetType, type NonEmptyArray } from '@metamask/utils';

import type { TokenMetadata, TokenMetadataResponse } from './api';
import { TokenMetadataResponseStruct } from './api';
import { TokenApiException } from './exceptions';
import type {
  AssetType,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../../api';
import { AppConfig } from '../../../config';
import {
  buildUrl,
  logger,
  batchesAllSettled,
  validateResponse,
} from '../../../utils';
import type { ILogger } from '../../../utils/logger';
import type { AssetMetadata, AssetUnit } from '../api';
import { getIconUrl } from '../utils';

export class TokenApiClient {
  static readonly #parallelBatchFetchLimit = 3;

  readonly #fetch: typeof globalThis.fetch;

  readonly #logger: ILogger;

  readonly #baseUrl: string;

  readonly #chunkSize: number;

  constructor(
    _fetch: typeof globalThis.fetch = globalThis.fetch,
    _logger: ILogger = logger,
  ) {
    this.#fetch = _fetch;
    this.#logger = _logger;

    const { tokenApi } = AppConfig.api;

    this.#baseUrl = tokenApi.baseUrl;
    this.#chunkSize = tokenApi.chunkSize;
  }

  async #fetchTokenMetadataBatch(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<TokenMetadataResponse> {
    const url = buildUrl({
      baseUrl: this.#baseUrl,
      path: '/v3/assets',
      queryParams: {
        assetIds: assetIds.join(','),
      },
    });

    const response = await this.#fetch(url);

    if (!response.ok) {
      throw new TokenApiException(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    validateResponse(data, TokenMetadataResponseStruct);

    return data;
  }

  async #fetchAllTokensMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<TokenMetadataResponse> {
    // example: https://tokens.api.cx.metamask.io/v3/chains/eip155:1329/assets?first=10&includeIconUrl=true&includeDuplicateSymbolAssets=true&useAggregatorIcons=true
    const url = buildUrl({
      baseUrl: this.#baseUrl,
      path: `/v3/chains/${scope}/assets`,
      queryParams: {
        first: '1000',
        includeIconUrl: 'true',
        includeDuplicateSymbolAssets: 'true',
        useAggregatorIcons: 'true',
      },
    });

    const response = await this.#fetch(url);

    if (!response.ok) {
      throw new TokenApiException(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    validateResponse(data, TokenMetadataResponseStruct);

    return data;
  }

  async getTokensMetadata(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<AssetMetadata[]> {
    try {
      // Split addresses into chunks
      const chunks: KnownCaip19AssetIdOrSlip44Id[][] = [];
      for (let index = 0; index < assetIds.length; index += this.#chunkSize) {
        chunks.push(assetIds.slice(index, index + this.#chunkSize));
      }

      const settled = await batchesAllSettled(
        chunks,
        TokenApiClient.#parallelBatchFetchLimit,
        async (chunk) => this.#fetchTokenMetadataBatch(chunk),
      );

      const tokenMetadataResponses: TokenMetadataResponse[] = [];
      for (const entry of settled) {
        if (entry.status === 'rejected') {
          throw entry.reason;
        }
        tokenMetadataResponses.push(entry.value);
      }

      const metadatas: AssetMetadata[] = [];

      // Note: it is possible that the token metadata does not contain all the asset ids.
      for (const tokenMetadataResponse of tokenMetadataResponses) {
        for (const tokenMetadata of tokenMetadataResponse) {
          metadatas.push(this.#toAssetMetadata(tokenMetadata));
        }
      }
      return metadatas;
    } catch (error) {
      this.#logger.logErrorWithDetails('Error fetching token metadata', error);
      throw new TokenApiException(`Failed to fetch token metadata`);
    }
  }

  async getAllTokensMetadata(
    scope: KnownCaip2ChainId,
  ): Promise<AssetMetadata[]> {
    try {
      const tokenMetadataResponses = await this.#fetchAllTokensMetadata(scope);
      // Note: it is possible that the token metadata does not contain all the asset ids.
      return tokenMetadataResponses.map((tokenMetadata) =>
        this.#toAssetMetadata(tokenMetadata),
      );
    } catch (error) {
      this.#logger.logErrorWithDetails('Error fetching token metadata', error);
      throw new TokenApiException(`Failed to fetch token metadata`);
    }
  }

  #toAssetMetadata(tokenMetadata: TokenMetadata): AssetMetadata {
    const name = tokenMetadata.name ?? 'UNKNOWN';
    const symbol = tokenMetadata.symbol ?? 'UNKNOWN';
    const { decimals } = tokenMetadata;
    const { assetId } = tokenMetadata;
    const units: NonEmptyArray<AssetUnit> = [{ name, symbol, decimals }];

    const { assetNamespace, chainId } = parseCaipAssetType(assetId);

    return {
      name,
      symbol,
      assetId,
      chainId: chainId as KnownCaip2ChainId,
      assetType: assetNamespace as AssetType,
      fungible: true as const,
      iconUrl: tokenMetadata.iconUrl ?? getIconUrl(assetId),
      units,
    };
  }
}
