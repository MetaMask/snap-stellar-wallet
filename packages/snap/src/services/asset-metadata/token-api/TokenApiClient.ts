import { array } from '@metamask/superstruct';

import type {
  TokenMetadataByAssetIdsResponse,
  TokenMetadataByChainIdResponse,
} from './api';
import {
  TokenMetadataByAssetIdsResponseStruct,
  TokenMetadataByChainIdResponseStruct,
} from './api';
import { TokenApiException } from './exceptions';
import {
  KnownCaip19AssetIdOrSlip44IdStruct,
  KnownCaip2ChainIdStruct,
  type KnownCaip19AssetIdOrSlip44Id,
  type KnownCaip2ChainId,
} from '../../../api';
import type { AnyErrorConstructor } from '../../../utils';
import { buildUrl, rethrowIfInstanceElseThrow } from '../../../utils';
import {
  assertHttpRequestParams,
  assertHttpResponse,
  HttpException,
  HttpResponseException,
  InvalidHttpRequestParamsException,
  InvalidHttpResponseException,
  normalizeHttpException,
} from '../../../utils/http';

export class TokenApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #baseUrl: string;

  constructor(
    {
      baseUrl,
    }: {
      baseUrl: string;
    },
    _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.#fetch = _fetch;
    this.#baseUrl = baseUrl;
  }

  async getAssetsByAssetIds(
    assetIds: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<TokenMetadataByAssetIdsResponse> {
    try {
      assertHttpRequestParams(
        assetIds,
        array(KnownCaip19AssetIdOrSlip44IdStruct),
      );

      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/v3/assets',
        queryParams: {
          assetIds: assetIds.join(','),
        },
      });

      const response = await this.#fetch(url);

      if (!response.ok) {
        throw new HttpResponseException(response.status);
      }

      const data = await response.json();

      assertHttpResponse(data, TokenMetadataByAssetIdsResponseStruct);

      return data;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to fetch token metadata by asset ids',
      });
    }
  }

  /**
   * Fetches all tokens metadata for the given chain ID.
   *
   * @see https://tokens.api.cx.metamask.io/v3/chains/eip155:1329/assets?first=10&includeIconUrl=true&includeDuplicateSymbolAssets=true&useAggregatorIcons=true
   *
   * @param scope - The chain ID to fetch all tokens metadata for.
   * @returns A Promise that resolves to the token metadata responses.
   */
  async getAssetsByChainId(
    scope: KnownCaip2ChainId,
  ): Promise<TokenMetadataByChainIdResponse> {
    try {
      assertHttpRequestParams(scope, KnownCaip2ChainIdStruct);

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
        throw new HttpResponseException(response.status);
      }

      const data = await response.json();

      assertHttpResponse(data, TokenMetadataByChainIdResponseStruct);

      return data;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Failed to fetch token metadata by chain id',
      });
    }
  }

  #throwError({
    error,
    exceptionClasses,
    fallbackError,
  }: {
    error: unknown;
    exceptionClasses?: readonly AnyErrorConstructor[];
    fallbackError: string | TokenApiException;
  }): never {
    const normalized = normalizeHttpException(error);
    if (normalized instanceof HttpException) {
      throw normalized;
    }

    return rethrowIfInstanceElseThrow(
      normalized,
      [
        TokenApiException,
        InvalidHttpRequestParamsException,
        InvalidHttpResponseException,
        ...(exceptionClasses ?? []),
      ],
      fallbackError instanceof Error
        ? fallbackError
        : new TokenApiException(String(fallbackError), { cause: error }),
    );
  }
}
