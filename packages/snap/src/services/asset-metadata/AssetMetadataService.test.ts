import type { StellarAssetMetadata } from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataService } from './AssetMetadataService';
import {
  AssetType,
  KnownCaip2ChainId,
  type KnownCaip19AssetId,
} from '../../api';
import { getSlip44AssetId, logger } from '../../utils';
import type { NetworkService } from '../network';
import { TokenApiClient } from './token-api/TokenApiClient';
import { NATIVE_ASSET_NAME, NATIVE_ASSET_SYMBOL } from '../../constants';

/** Mainnet classic USDC (matches CAIP-19 pattern used across Stellar fixtures). */
const MAINNET_CLASSIC_USDC =
  'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as KnownCaip19AssetId;

jest.mock('../../config', () => ({
  AppConfig: {
    api: {
      tokenApi: {
        baseUrl: 'https://tokens.test',
        chunkSize: 10,
      },
      staticApi: {
        baseUrl: 'https://static.test',
      },
    },
  },
}));

jest.mock('../../utils/logger');

jest.mock('./token-api/TokenApiClient', () => ({
  TokenApiClient: jest.fn(),
}));

const mockGetTokensMetadata = jest.fn();

function createCachedRow(
  assetId: KnownCaip19AssetId,
  chainId: KnownCaip2ChainId,
): StellarAssetMetadata {
  return {
    assetId,
    assetType: AssetType.Token,
    chainId,
    name: 'Cached',
    symbol: 'CCH',
    fungible: true,
    iconUrl: 'https://example.test/icon.png',
    units: [{ name: 'Cached', symbol: 'CCH', decimals: 7 }],
  };
}

function createService(deps: {
  repo?: Partial<AssetMetadataRepository>;
  network?: Partial<NetworkService>;
}) {
  const defaults = {
    getByAssetIds: jest.fn().mockResolvedValue([]),
    saveMany: jest.fn().mockResolvedValue(undefined),
    getByAssetType: jest.fn().mockResolvedValue([]),
    getAll: jest.fn().mockResolvedValue([]),
    getByAssetId: jest.fn().mockResolvedValue(null),
  };

  const repo = {
    ...defaults,
    ...deps.repo,
  } as unknown as AssetMetadataRepository;

  const network = {
    getAssetsData: jest.fn().mockResolvedValue([]),
    getClassicAssetData: jest.fn(),
    ...deps.network,
  } as unknown as NetworkService;

  (TokenApiClient as jest.Mock).mockImplementation(() => ({
    getTokensMetadata: mockGetTokensMetadata,
    getAllTokensMetadata: jest.fn(),
  }));

  const service = new AssetMetadataService({
    networkService: network,
    assetMetadataRepository: repo,
    logger,
  });

  return {
    service,
    getByAssetIds: repo.getByAssetIds as jest.MockedFunction<
      AssetMetadataRepository['getByAssetIds']
    >,
    saveMany: repo.saveMany as jest.MockedFunction<
      AssetMetadataRepository['saveMany']
    >,
    getAssetsData: network.getAssetsData as jest.MockedFunction<
      NetworkService['getAssetsData']
    >,
    getClassicAssetData: network.getClassicAssetData as jest.MockedFunction<
      NetworkService['getClassicAssetData']
    >,
  };
}

describe('AssetMetadataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTokensMetadata.mockResolvedValue([]);
  });

  it('returns native metadata for mainnet slip44 id', async () => {
    const { service, getByAssetIds } = createService({});
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const result = await service.resolve(slipId);

    expect(result.assetId).toBe(slipId);
    expect(getByAssetIds).toHaveBeenCalledWith([]);
    expect(mockGetTokensMetadata).not.toHaveBeenCalled();
  });

  it('loads mainnet classic from Horizon when token API and cache miss', async () => {
    const classicId = MAINNET_CLASSIC_USDC;
    const rpcRow = {
      assetId: classicId,
      symbol: 'USDC',
      decimals: 7,
      name: 'USD Coin',
    };
    const { service, getClassicAssetData } = createService({
      network: {
        getClassicAssetData: jest.fn().mockResolvedValue(rpcRow),
      },
    });

    const result = await service.resolve(classicId);

    expect(result.assetId).toBe(classicId);
    expect(result.symbol).toBe('USDC');
    expect(mockGetTokensMetadata).toHaveBeenCalled();
    expect(getClassicAssetData).toHaveBeenCalledWith(
      classicId,
      KnownCaip2ChainId.Mainnet,
    );
  });

  it('returns cached mainnet classic asset without calling token API', async () => {
    const classicId = MAINNET_CLASSIC_USDC;
    const cached = createCachedRow(classicId, KnownCaip2ChainId.Mainnet);
    const { service, getByAssetIds, saveMany } = createService({
      repo: {
        getByAssetIds: jest.fn().mockResolvedValue([cached]),
      },
    });

    const result = await service.resolve(classicId);

    expect(result).toStrictEqual(cached);
    expect(getByAssetIds).toHaveBeenCalledWith([classicId]);
    expect(mockGetTokensMetadata).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('fills keyring metadata map for mainnet slip44 and classic', async () => {
    const classicId = MAINNET_CLASSIC_USDC;
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const rpcRow = {
      assetId: classicId,
      symbol: 'USDC',
      decimals: 7,
      name: 'USD Coin',
    };
    const { service, saveMany } = createService({
      network: {
        getClassicAssetData: jest.fn().mockResolvedValue(rpcRow),
      },
    });

    const map = await service.getAssetsMetadataByAssetIds([classicId, slipId]);

    expect(map[classicId]).toMatchObject({
      fungible: true,
      symbol: 'USDC',
      name: 'USD Coin',
      iconUrl: expect.any(String),
      units: expect.any(Array),
    });
    expect(map[slipId]).toMatchObject({
      fungible: true,
      iconUrl: expect.any(String),
      units: expect.any(Array),
      symbol: expect.any(String),
      name: expect.any(String),
    });
    expect(saveMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: classicId,
          symbol: 'USDC',
        }),
      ]),
    );
  });

  it('deduplicates duplicate asset ids before fetch pipeline', async () => {
    const classicId = MAINNET_CLASSIC_USDC;
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const rpcRow = {
      assetId: classicId,
      symbol: 'USDC',
      decimals: 7,
      name: 'USD Coin',
    };
    const { service, getByAssetIds, getClassicAssetData } = createService({
      network: {
        getClassicAssetData: jest.fn().mockResolvedValue(rpcRow),
      },
    });

    const result = await service.getAssetsMetadataByAssetIds([
      classicId,
      classicId,
      slipId,
      slipId,
    ]);

    expect(getByAssetIds).toHaveBeenCalledWith([classicId]);
    expect(mockGetTokensMetadata).toHaveBeenCalledWith([classicId]);
    expect(getClassicAssetData).toHaveBeenCalledTimes(1);
    expect(result[classicId]).toMatchObject({
      symbol: 'USDC',
      name: 'USD Coin',
    });
    expect(result[slipId]).toMatchObject({
      symbol: NATIVE_ASSET_SYMBOL,
      name: NATIVE_ASSET_NAME,
    });
  });

  it('delegates getPersistedSep41AssetsMetadata to repository', async () => {
    const sepRows: StellarAssetMetadata[] = [];
    const getByAssetType = jest.fn().mockResolvedValue(sepRows);
    const { service } = createService({
      repo: { getByAssetType },
    });

    const result = await service.getPersistedSep41AssetsMetadata(
      KnownCaip2ChainId.Mainnet,
    );

    expect(result).toBe(sepRows);
    expect(getByAssetType).toHaveBeenCalledWith(
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );
  });
});
