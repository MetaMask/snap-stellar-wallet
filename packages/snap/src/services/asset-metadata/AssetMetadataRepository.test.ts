import { cloneDeep } from 'lodash';

import type { AssetMetadataState, StellarAssetMetadata } from './api';
import { AssetMetadataRepository } from './AssetMetadataRepository';
import {
  AssetType,
  KnownCaip2ChainId,
  type KnownCaip19AssetId,
} from '../../api';
import type { IStateManager } from '../state/IStateManager';

const classicId =
  'stellar:testnet/asset:USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as KnownCaip19AssetId;

const sep41Id =
  'stellar:pubnet/sep41:CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J' as KnownCaip19AssetId;

function generateAssetData(
  assetId: KnownCaip19AssetId,
  assetType: AssetType,
  chainId: KnownCaip2ChainId,
): StellarAssetMetadata {
  return {
    assetId,
    assetType,
    chainId,
    name: 'N',
    symbol: 'S',
    fungible: true,
    iconUrl: 'https://example.test/icon.png',
    units: [{ name: 'N', symbol: 'S', decimals: 7 }],
  };
}

/**
 *
 * @param initial
 */
function createMockStateManager(
  initial: AssetMetadataState,
): IStateManager<AssetMetadataState> {
  let state = cloneDeep(initial);
  return {
    get: async () => cloneDeep(state),
    getKey: async <TResponse>(key: string) => {
      if (key === 'assets') {
        return cloneDeep(state.assets) as TResponse;
      }
      return undefined;
    },
    setKey: jest.fn(async (key: string, value: unknown) => {
      if (key === 'assets') {
        state.assets = cloneDeep(value) as AssetMetadataState['assets'];
      }
    }),
    update: async (updater) => {
      state = updater(cloneDeep(state));
      return cloneDeep(state);
    },
    deleteKey: jest.fn(async () => Promise.resolve()),
  };
}

describe('AssetMetadataRepository', () => {
  it('returns rows for getByAssetIds in request order', async () => {
    const classic = generateAssetData(
      classicId,
      AssetType.Token,
      KnownCaip2ChainId.Testnet,
    );
    const sep41 = generateAssetData(
      sep41Id,
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );
    const manager = createMockStateManager({
      assets: { [classicId]: classic, [sep41Id]: sep41 },
    });
    const repo = new AssetMetadataRepository(manager);

    expect(await repo.getByAssetIds([sep41Id, classicId])).toStrictEqual([
      sep41,
      classic,
    ]);
  });

  it('filters getByAssetType by assetType and chainId', async () => {
    const classic = generateAssetData(
      classicId,
      AssetType.Token,
      KnownCaip2ChainId.Testnet,
    );
    const sep41 = generateAssetData(
      sep41Id,
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );
    const manager = createMockStateManager({
      assets: { [classicId]: classic, [sep41Id]: sep41 },
    });
    const repo = new AssetMetadataRepository(manager);

    expect(
      await repo.getByAssetType(AssetType.Sep41, KnownCaip2ChainId.Mainnet),
    ).toStrictEqual([sep41]);
  });

  it('sets persistedAt when saving', async () => {
    const manager = createMockStateManager({ assets: {} });
    const repo = new AssetMetadataRepository(manager);
    const row = generateAssetData(
      sep41Id,
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );
    const before = Date.now();

    await repo.saveMany([row]);

    const saved = await repo.getByAssetId(sep41Id);
    expect(saved).toMatchObject({
      ...row,
      persistedAt: expect.any(Number),
    });
    expect(saved?.persistedAt).toBeGreaterThanOrEqual(before);
    expect(saved?.persistedAt).toBeLessThanOrEqual(Date.now());
  });

  it('resolves getByAssetId from assets map', async () => {
    const row = generateAssetData(
      classicId,
      AssetType.Token,
      KnownCaip2ChainId.Testnet,
    );
    const manager = createMockStateManager({ assets: { [classicId]: row } });
    const repo = new AssetMetadataRepository(manager);

    expect(await repo.getByAssetId(classicId)).toStrictEqual(row);
    expect(await repo.getByAssetId(sep41Id)).toBeNull();
  });

  it('preserves all rows when saveMany runs concurrently for disjoint asset ids', async () => {
    const manager = createMockStateManager({ assets: {} });
    const repo = new AssetMetadataRepository(manager);
    const classic = generateAssetData(
      classicId,
      AssetType.Token,
      KnownCaip2ChainId.Testnet,
    );
    const sep41 = generateAssetData(
      sep41Id,
      AssetType.Sep41,
      KnownCaip2ChainId.Mainnet,
    );

    await Promise.all([repo.saveMany([classic]), repo.saveMany([sep41])]);

    expect(await repo.getByAssetId(classicId)).toMatchObject({
      assetId: classicId,
      persistedAt: expect.any(Number),
    });
    expect(await repo.getByAssetId(sep41Id)).toMatchObject({
      assetId: sep41Id,
      persistedAt: expect.any(Number),
    });
  });
});
