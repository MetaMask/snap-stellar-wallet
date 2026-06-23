import { TokenApiClient } from './TokenApiClient';
import { KnownCaip2ChainId } from '../../../api';
import { buildUrl } from '../../../utils';
import {
  HttpException,
  HttpResponseException,
  InvalidHttpResponseException,
} from '../../../utils/http';

const baseUrl = 'https://tokens.test';

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

const tokenMetadataResponse = (
  assetId: string,
  overrides: Record<string, unknown> = {},
) => ({
  assetId,
  decimals: 7,
  ...overrides,
});

describe('TokenApiClient', () => {
  const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createClient = () => new TokenApiClient({ baseUrl }, mockFetch);

  describe('getAssetsByAssetIds', () => {
    it('requests token API with assetIds in query and returns parsed body', async () => {
      const body = [
        tokenMetadataResponse(classicAssetId, {
          name: 'USD Coin',
          symbol: 'USDC',
        }),
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const client = createClient();
      const result = await client.getAssetsByAssetIds([classicAssetId]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: '/v3/assets',
          queryParams: { assetIds: classicAssetId },
        }),
      );
      expect(result).toStrictEqual(body);
    });

    it('joins multiple asset ids in the query param', async () => {
      const body = [
        tokenMetadataResponse(sep41AssetIdA, { name: 'A', symbol: 'A' }),
        tokenMetadataResponse(sep41AssetIdB, {
          decimals: 18,
          name: 'B',
          symbol: 'B',
        }),
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const client = createClient();
      await client.getAssetsByAssetIds([sep41AssetIdA, sep41AssetIdB]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const urlArg = mockFetch.mock.calls[0]?.[0];
      expect(typeof urlArg).toBe('string');
      const assetIdsParam = new URL(urlArg as string).searchParams.get(
        'assetIds',
      );
      expect(assetIdsParam).toBe(`${sep41AssetIdA},${sep41AssetIdB}`);
    });

    it('throws HttpResponseException when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([], { ok: false, status: 503 }),
      );

      const client = createClient();
      await expect(
        client.getAssetsByAssetIds([classicAssetId]),
      ).rejects.toThrow(HttpResponseException);
    });

    it('throws InvalidHttpResponseException when response body is invalid', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ notAnArray: true }));

      const client = createClient();
      await expect(
        client.getAssetsByAssetIds([classicAssetId]),
      ).rejects.toThrow(InvalidHttpResponseException);
    });

    it('throws HttpException when fetch rejects', async () => {
      const networkError = Object.assign(new Error('network down'), {
        cause: { code: 'ECONNREFUSED' },
      });
      mockFetch.mockRejectedValueOnce(networkError);

      const client = createClient();
      await expect(
        client.getAssetsByAssetIds([classicAssetId]),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getAssetsByChainId', () => {
    it('requests chain token API and returns parsed body', async () => {
      const body = {
        data: [
          tokenMetadataResponse(sep41AssetIdA, { name: 'A', symbol: 'A' }),
        ],
        count: 1,
        totalCount: 1,
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const client = createClient();
      const result = await client.getAssetsByChainId(KnownCaip2ChainId.Mainnet);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        buildUrl({
          baseUrl,
          path: `/v3/chains/${KnownCaip2ChainId.Mainnet}/assets`,
          queryParams: {
            first: '1000',
            includeIconUrl: 'true',
            includeDuplicateSymbolAssets: 'true',
            useAggregatorIcons: 'true',
          },
        }),
      );
      expect(result).toStrictEqual(body);
    });

    it('returns parsed body when response data is empty', async () => {
      const body = {
        data: [],
        count: 0,
        totalCount: 0,
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const client = createClient();
      expect(
        await client.getAssetsByChainId(KnownCaip2ChainId.Testnet),
      ).toStrictEqual(body);
    });

    it('throws HttpResponseException on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [] }, { ok: false, status: 502 }),
      );

      const client = createClient();
      await expect(
        client.getAssetsByChainId(KnownCaip2ChainId.Mainnet),
      ).rejects.toThrow(HttpResponseException);
    });

    it('throws InvalidHttpResponseException when body does not match schema', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([{ notValid: true }]));

      const client = createClient();
      await expect(
        client.getAssetsByChainId(KnownCaip2ChainId.Mainnet),
      ).rejects.toThrow(InvalidHttpResponseException);
    });

    it('throws HttpException when fetch rejects', async () => {
      const networkError = Object.assign(new Error('network down'), {
        cause: { code: 'ECONNREFUSED' },
      });
      mockFetch.mockRejectedValueOnce(networkError);

      const client = createClient();
      await expect(
        client.getAssetsByChainId(KnownCaip2ChainId.Mainnet),
      ).rejects.toThrow(HttpException);
    });
  });
});
