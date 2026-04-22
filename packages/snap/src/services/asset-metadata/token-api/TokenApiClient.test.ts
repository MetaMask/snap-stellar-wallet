import { TokenApiClient } from './TokenApiClient';
import { AssetType, KnownCaip2ChainId } from '../../../api';
import { buildUrl, logger } from '../../../utils';

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

describe('TokenApiClient', () => {
  const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  const createClient = () =>
    new TokenApiClient(tokenApiClientOptions, logger, mockFetch);

  beforeEach(() => {
    jest.clearAllMocks();
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

    it('wraps invalid response bodies in TokenApiException', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ notAnArray: true }));

      const client = createClient();
      await expect(
        client.getTokensMetadata([classicAssetId]),
      ).rejects.toMatchObject({
        name: 'TokenApiException',
        message: 'Failed to fetch token metadata',
      });
    });
  });
});
