import { TokenApiClient } from './TokenApiClient';
import { AssetType, KnownCaip2ChainId } from '../../../api';
import { buildUrl, logger } from '../../../utils';

const pubnetClassicUsdc =
  'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const;

const sep41AssetIdC =
  'stellar:pubnet/sep41:CBGV2QFQBBGEQRUKUMCPO3SZOHDDYO6SCP5CH6TW7EALKVHCXTMWDDOF' as const;

jest.mock('../../../config', () => ({
  AppConfig: {
    api: {
      tokenApi: {
        baseUrl: 'https://tokens.test',
        chunkSize: 2,
      },
      staticApi: {
        baseUrl: 'https://static.test',
      },
    },
  },
}));

jest.mock('../../../utils/logger');

const classicAssetId =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as const;

/** Known-valid SEP-41 ids (see `api/asset.test.ts`). */
const sep41AssetIdA =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as const;

const sep41AssetIdB =
  'stellar:pubnet/sep41:CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN' as const;

const jsonResponse = (
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response => {
  const { ok = true, status = ok ? 200 : 500 } = init;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
};

const tokenApiClientOptions = {
  baseUrl: 'https://tokens.test',
  chunkSize: 2,
} as const;

/**
 * Batches of chunks can be executed in parallel; the mock must branch on the request URL
 * to return a failure for one chunk and success for the other.
 *
 * @param secondChunkRequestMarker - Substring present only in the successful chunk request URL.
 * @param secondChunkResponseBody - JSON body for a 200 response for that chunk.
 */
function createFetchForPartiallyFailingBatches(
  secondChunkRequestMarker: string,
  secondChunkResponseBody: unknown,
): typeof fetch {
  return async (url: RequestInfo | URL) => {
    let href: string;
    if (typeof url === 'string') {
      href = url;
    } else if (url instanceof URL) {
      href = url.href;
    } else {
      href = url.url;
    }
    if (href.includes(secondChunkRequestMarker)) {
      return jsonResponse(secondChunkResponseBody);
    }
    return jsonResponse([], { ok: false, status: 503 });
  };
}

describe('TokenApiClient', () => {
  const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  const createClient = () =>
    new TokenApiClient(tokenApiClientOptions, logger, mockFetch);

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks does not remove mockImplementation; a prior test that used it
    // would otherwise take precedence over mockResolvedValueOnce.
    mockFetch.mockReset();
  });

  describe('getTokensMetadata', () => {
    it('returns empty array when assetIds is empty', async () => {
      const client = createClient();
      expect(await client.getTokensMetadata([])).toStrictEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('requests token API with batched assetIds in query and maps response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            assetId: classicAssetId,
            decimals: 7,
            name: 'USD Coin',
            symbol: 'USDC',
          },
        ]),
      );

      const client = createClient();
      const result = await client.getTokensMetadata([classicAssetId]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const urlArg = mockFetch.mock.calls[0]?.[0];
      expect(typeof urlArg).toBe('string');
      expect(urlArg).toBe(
        buildUrl({
          baseUrl: 'https://tokens.test',
          path: '/v3/assets',
          queryParams: { assetIds: classicAssetId },
        }),
      );

      const row = result.find((entry) => entry.assetId === classicAssetId);
      expect(row).toStrictEqual({
        name: 'USD Coin',
        symbol: 'USDC',
        assetId: classicAssetId,
        chainId: KnownCaip2ChainId.Testnet,
        assetType: AssetType.Token,
        fungible: true,
        iconUrl: buildUrl({
          baseUrl: 'https://static.test',
          path: '/api/v2/tokenIcons/assets/{assetId}.png',
          pathParams: {
            assetId: classicAssetId.replace(/:/gu, '/'),
          },
          encodePathParams: false,
        }),
        units: [{ name: 'USD Coin', symbol: 'USDC', decimals: 7 }],
      });
    });

    it('joins multiple ids per chunk using configured chunkSize', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            assetId: sep41AssetIdA,
            decimals: 7,
            name: 'A',
            symbol: 'A',
          },
          {
            assetId: sep41AssetIdB,
            decimals: 18,
            name: 'B',
            symbol: 'B',
          },
        ]),
      );

      const client = createClient();
      await client.getTokensMetadata([sep41AssetIdA, sep41AssetIdB]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const urlArg = mockFetch.mock.calls[0]?.[0];
      expect(typeof urlArg).toBe('string');
      const assetIdsParam = new URL(urlArg as string).searchParams.get(
        'assetIds',
      );
      expect(assetIdsParam).toBe(`${sep41AssetIdA},${sep41AssetIdB}`);
    });

    it('uses UNKNOWN when name and symbol are absent', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            assetId: sep41AssetIdA,
            decimals: 7,
          },
        ]),
      );

      const client = createClient();
      const result = await client.getTokensMetadata([sep41AssetIdA]);

      const row = result.find((entry) => entry.assetId === sep41AssetIdA);
      expect(row).toMatchObject({
        name: 'UNKNOWN',
        symbol: 'UNKNOWN',
        units: [{ name: 'UNKNOWN', symbol: 'UNKNOWN', decimals: 7 }],
        assetType: AssetType.Sep41,
      });
    });

    it('uses response iconUrl when provided', async () => {
      const iconUrl = 'https://cdn.example/token.png';
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            assetId: sep41AssetIdA,
            decimals: 7,
            name: 'T',
            symbol: 'T',
            iconUrl,
          },
        ]),
      );

      const client = createClient();
      const result = await client.getTokensMetadata([sep41AssetIdA]);

      expect(
        result.find((entry) => entry.assetId === sep41AssetIdA)?.iconUrl,
      ).toBe(iconUrl);
    });

    it('returns empty array when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([], { ok: false, status: 503 }),
      );

      const client = createClient();
      expect(await client.getTokensMetadata([classicAssetId])).toStrictEqual(
        [],
      );
    });

    it('returns empty array when response body is invalid (batch is skipped)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ notAnArray: true }));

      const client = createClient();
      expect(await client.getTokensMetadata([classicAssetId])).toStrictEqual(
        [],
      );
    });

    it('returns metadata from successful chunk when another chunk fails', async () => {
      mockFetch.mockImplementation(
        createFetchForPartiallyFailingBatches('CBGV2QFQBBGEQR', [
          {
            assetId: sep41AssetIdB,
            decimals: 18,
            name: 'B',
            symbol: 'B',
          },
        ]),
      );

      const client = createClient();
      const result = await client.getTokensMetadata([
        pubnetClassicUsdc,
        sep41AssetIdA,
        sep41AssetIdB,
        sep41AssetIdC,
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.assetId).toBe(sep41AssetIdB);
    });
  });

  describe('getAllTokensMetadata', () => {
    it('requests chain token API and maps data array to metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              assetId: sep41AssetIdA,
              decimals: 7,
              name: 'A',
              symbol: 'A',
            },
          ],
          count: 1,
          totalCount: 1,
        }),
      );

      const client = createClient();
      const result = await client.getAllTokensMetadata(
        KnownCaip2ChainId.Mainnet,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const urlArg = mockFetch.mock.calls[0]?.[0];
      expect(urlArg).toBe(
        buildUrl({
          baseUrl: 'https://tokens.test',
          path: `/v3/chains/${KnownCaip2ChainId.Mainnet}/assets`,
          queryParams: {
            first: '1000',
            includeIconUrl: 'true',
            includeDuplicateSymbolAssets: 'true',
            useAggregatorIcons: 'true',
          },
        }),
      );

      const row = result.find((entry) => entry.assetId === sep41AssetIdA);
      expect(row).toMatchObject({
        name: 'A',
        symbol: 'A',
        chainId: KnownCaip2ChainId.Mainnet,
        assetType: AssetType.Sep41,
        fungible: true,
        units: [{ name: 'A', symbol: 'A', decimals: 7 }],
      });
      expect(row?.iconUrl).toBe(
        buildUrl({
          baseUrl: 'https://static.test',
          path: '/api/v2/tokenIcons/assets/{assetId}.png',
          pathParams: {
            assetId: sep41AssetIdA.replace(/:/gu, '/'),
          },
          encodePathParams: false,
        }),
      );
    });

    it('returns empty array when response data is empty', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [],
          count: 0,
          totalCount: 0,
        }),
      );

      const client = createClient();
      expect(
        await client.getAllTokensMetadata(KnownCaip2ChainId.Testnet),
      ).toStrictEqual([]);
    });

    it('uses response iconUrl when provided', async () => {
      const iconUrl = 'https://cdn.example/chain-asset.png';
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              assetId: sep41AssetIdA,
              decimals: 7,
              name: 'A',
              symbol: 'A',
              iconUrl,
            },
          ],
          count: 1,
          totalCount: 1,
        }),
      );

      const client = createClient();
      const result = await client.getAllTokensMetadata(
        KnownCaip2ChainId.Mainnet,
      );
      expect(result.find((row) => row.assetId === sep41AssetIdA)?.iconUrl).toBe(
        iconUrl,
      );
    });

    it('rejects with TokenApiException on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [] }, { ok: false, status: 502 }),
      );

      const client = createClient();
      await expect(
        client.getAllTokensMetadata(KnownCaip2ChainId.Mainnet),
      ).rejects.toMatchObject({
        name: 'TokenApiException',
        message: 'HTTP error! status: 502',
      });
    });

    it('rejects with TokenApiException when body does not match schema', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([{ notValid: true }]));

      const client = createClient();
      await expect(
        client.getAllTokensMetadata(KnownCaip2ChainId.Mainnet),
      ).rejects.toMatchObject({
        name: 'TokenApiException',
        message: 'Failed to fetch token metadata',
      });
    });
  });
});
