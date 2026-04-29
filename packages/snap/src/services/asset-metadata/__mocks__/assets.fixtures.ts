import type { KnownCaip19AssetIdOrSlip44Id } from '../../../api';
import { AssetType, KnownCaip2ChainId } from '../../../api';
import { NATIVE_ASSET_NAME, NATIVE_ASSET_SYMBOL } from '../../../constants';
import { getSlip44AssetId } from '../../../utils/caip';
import { logger } from '../../../utils/logger';
import { NetworkService } from '../../network';
import { State } from '../../state';
import type {
  AssetMetadataByAssetId,
  KeyringAssetMetadataByAssetId,
} from '../api';
import { AssetMetadataRepository } from '../AssetMetadataRepository';
import { AssetMetadataService } from '../AssetMetadataService';

export const NATIVE: KnownCaip19AssetIdOrSlip44Id = `${getSlip44AssetId(KnownCaip2ChainId.Mainnet)}`;
export const USDC_CLASSIC: KnownCaip19AssetIdOrSlip44Id =
  'stellar:pubnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
export const USDC_SEP41: KnownCaip19AssetIdOrSlip44Id =
  'stellar:pubnet/sep41:CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
export const USDT_SEP41: KnownCaip19AssetIdOrSlip44Id =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J';

export const generateMockStellarAssetMetadata = (): AssetMetadataByAssetId => {
  return {
    [NATIVE]: {
      assetId: NATIVE,
      assetType: AssetType.Native,
      chainId: KnownCaip2ChainId.Mainnet,
      name: NATIVE_ASSET_NAME,
      symbol: NATIVE_ASSET_SYMBOL,
      fungible: true,
      iconUrl: 'https://example.test/icon.png',
    },
    [USDC_CLASSIC]: {
      assetId: USDC_CLASSIC,
      assetType: AssetType.Token,
      chainId: KnownCaip2ChainId.Mainnet,
      name: 'USDC',
      symbol: 'USDC',
      fungible: true,
      iconUrl: 'https://example.test/icon.png',
      units: [{ name: 'USDC', symbol: 'USDC', decimals: 7 }],
    },
    [USDC_SEP41]: {
      assetId: USDC_SEP41,
      assetType: AssetType.Sep41,
      chainId: KnownCaip2ChainId.Mainnet,
      name: 'USDC',
      symbol: 'USDC',
      fungible: true,
      iconUrl: 'https://example.test/icon.png',
      units: [{ name: 'USDC', symbol: 'USDC', decimals: 7 }],
    },
    [USDT_SEP41]: {
      assetId: USDT_SEP41,
      assetType: AssetType.Sep41,
      chainId: KnownCaip2ChainId.Mainnet,
      name: 'USDT',
      symbol: 'USDT',
      fungible: true,
      iconUrl: 'https://example.test/icon.png',
      units: [{ name: 'USDT', symbol: 'USDT', decimals: 7 }],
    },
  } as AssetMetadataByAssetId;
};

export const generateMockKeyringAssetMetadata =
  (): KeyringAssetMetadataByAssetId => {
    return {
      [NATIVE]: {
        name: NATIVE_ASSET_NAME,
        symbol: NATIVE_ASSET_SYMBOL,
        fungible: true,
        iconUrl: 'https://example.test/icon.png',
        units: [
          {
            name: NATIVE_ASSET_NAME,
            symbol: NATIVE_ASSET_SYMBOL,
            decimals: 7,
          },
        ],
      },
      [USDC_CLASSIC]: {
        name: 'USDC',
        symbol: 'USDC',
        fungible: true,
        iconUrl: 'https://example.test/icon.png',
        units: [{ name: 'USDC', symbol: 'USDC', decimals: 7 }],
      },
      [USDC_SEP41]: {
        name: 'USDC',
        symbol: 'USDC',
        fungible: true,
        iconUrl: 'https://example.test/icon.png',
        units: [{ name: 'USDC', symbol: 'USDC', decimals: 7 }],
      },
      [USDT_SEP41]: {
        name: 'USDT',
        symbol: 'USDT',
        fungible: true,
        iconUrl: 'https://example.test/icon.png',
        units: [{ name: 'USDT', symbol: 'USDT', decimals: 7 }],
      },
    } as KeyringAssetMetadataByAssetId;
  };

export const createMockAssetMetadataService = () => {
  const service = new AssetMetadataService({
    networkService: new NetworkService({ logger }),
    assetMetadataRepository: new AssetMetadataRepository(
      new State({
        encrypted: false,
        defaultState: { assets: generateMockStellarAssetMetadata() },
      }),
    ),
    logger,
  });

  const assetMetadataRepositorySaveManySpy = jest.spyOn(
    AssetMetadataRepository.prototype,
    'saveMany',
  );

  const assetMetadataRepositoryGetByAssetIdsSpy = jest.spyOn(
    AssetMetadataRepository.prototype,
    'getByAssetIds',
  );

  const getAssetsMetadataByAssetIdsSpy = jest.spyOn(
    AssetMetadataService.prototype,
    'getAssetsMetadataByAssetIds',
  );

  return {
    service,
    assetMetadataRepositorySaveManySpy,
    assetMetadataRepositoryGetByAssetIdsSpy,
    getAssetsMetadataByAssetIdsSpy,
  };
};
