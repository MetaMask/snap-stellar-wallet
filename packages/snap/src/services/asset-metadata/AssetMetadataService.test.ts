import type { AssetMetadata } from '@metamask/snaps-sdk';

import type { StellarAssetMetadata } from './api';
import type { AssetMetadataRepository } from './AssetMetadataRepository';
import { AssetMetadataService } from './AssetMetadataService';
import { AssetMetadataServiceException } from './exceptions';
import {
  AssetType,
  KnownCaip2ChainId,
  type KnownCaip19AssetId,
} from '../../api';
import { getSlip44AssetId, logger } from '../../utils';
import type { NetworkService } from '../network';
import { TokenApiClient } from './token-api/TokenApiClient';

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

const testnetClassicId =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as KnownCaip19AssetId;

const pubnetClassicId =
  'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as KnownCaip19AssetId;

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

  it('returns native metadata for slip44 id matching scope', async () => {
    const { service, getByAssetIds } = createService({});
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Testnet);
    const result = await service.resolve({
      assetId: slipId,
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result.assetId).toBe(slipId);
    expect(getByAssetIds).toHaveBeenCalledWith([]);
    expect(mockGetTokensMetadata).not.toHaveBeenCalled();
  });

  it('throws when asset chain does not match scope', async () => {
    const { service } = createService({});
    await expect(
      service.resolve({
        assetId: pubnetClassicId,
        scope: KnownCaip2ChainId.Testnet,
      }),
    ).rejects.toThrow(AssetMetadataServiceException);
  });

  it('loads testnet classic from Horizon when cache misses and skips token API', async () => {
    const rpcRow = {
      assetId: testnetClassicId,
      symbol: 'USDC',
      decimals: 7,
      name: 'USD Coin',
    };
    const { service, getClassicAssetData } = createService({
      network: {
        getClassicAssetData: jest.fn().mockResolvedValue(rpcRow),
      },
    });

    const result = await service.resolve({
      assetId: testnetClassicId,
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result.assetId).toBe(testnetClassicId);
    expect(result.symbol).toBe('USDC');
    expect(getClassicAssetData).toHaveBeenCalledWith(
      testnetClassicId,
      KnownCaip2ChainId.Testnet,
    );
    expect(mockGetTokensMetadata).not.toHaveBeenCalled();
  });

  it('returns cached classic asset without calling token API', async () => {
    const cached = createCachedRow(testnetClassicId, KnownCaip2ChainId.Testnet);
    const { service, getByAssetIds, saveMany } = createService({
      repo: {
        getByAssetIds: jest.fn().mockResolvedValue([cached]),
      },
    });

    const result = await service.resolve({
      assetId: testnetClassicId,
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result).toStrictEqual(cached);
    expect(getByAssetIds).toHaveBeenCalledWith([testnetClassicId]);
    expect(mockGetTokensMetadata).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('fills keyring metadata map and leaves wrong-scope ids null', async () => {
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Testnet);
    const { service } = createService({});

    const map = await service.getAssetsMetadataByAssetIds(
      [pubnetClassicId, slipId],
      KnownCaip2ChainId.Testnet,
    );

    expect(map[pubnetClassicId]).toBeNull();
    expect(map[slipId]).toStrictEqual({
      fungible: true,
      iconUrl: expect.any(String),
      units: expect.any(Array),
      symbol: expect.any(String),
      name: expect.any(String),
    } satisfies AssetMetadata);
  });

  it('delegates getAllSep41AssetsMetadata to repository', async () => {
    const sepRows: StellarAssetMetadata[] = [];
    const getByAssetType = jest.fn().mockResolvedValue(sepRows);
    const { service } = createService({
      repo: { getByAssetType },
    });

    const result = await service.getAllSep41AssetsMetadata(
      KnownCaip2ChainId.Mainnet,
    );

    expect(result).toBe(sepRows);
    expect(getByAssetType).toHaveBeenCalledWith(
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );
  });
});
