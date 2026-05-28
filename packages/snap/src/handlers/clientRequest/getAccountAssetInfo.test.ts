import { BigNumber } from 'bignumber.js';

import type { GetAccountAssetInfoJsonRpcResponse } from './api';
import { ClientRequestMethod } from './api';
import { GetAccountAssetInfoHandler } from './getAccountAssetInfo';
import {
  type KnownCaip19AssetIdOrSlip44Id,
  type KnownCaip19ClassicAssetId,
  KnownCaip2ChainId,
} from '../../api';
import { AccountService } from '../../services/account';
import { AccountAssetInfoService } from '../../services/account-asset-info';
import { GetAccountAssetInfoException } from '../../services/account-asset-info/exceptions';
import {
  createMockAssetMetadataService,
  generateMockKeyringAssetMetadata,
  USDC_CLASSIC,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';
import type { KeyringAssetMetadataByAssetId } from '../../services/asset-metadata/api';
import { OnChainAccountService } from '../../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
  type MockAccountWithBalancesData,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import { getSlip44AssetId } from '../../utils';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('GetAccountAssetInfoHandler', () => {
  const mockAccountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;
  let handler: GetAccountAssetInfoHandler;

  const createTestOnChainAccount = (
    address: string,
    data: MockAccountWithBalancesData = DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  ): OnChainAccount => {
    const stellarAccount = createMockAccountWithBalances(address, '1', data);
    return new OnChainAccount(
      stellarAccount,
      KnownCaip2ChainId.Mainnet,
      horizonSource(stellarAccount, KnownCaip2ChainId.Mainnet),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();

    const { accountService, onChainAccountService } =
      mockOnChainAccountService();
    const { service: assetMetadataService, getAssetsMetadataByAssetIdsSpy } =
      createMockAssetMetadataService();
    const mockKeyringAssetMetadata = generateMockKeyringAssetMetadata();
    getAssetsMetadataByAssetIdsSpy.mockImplementation(
      async (assetIds: KnownCaip19AssetIdOrSlip44Id[]) => {
        const metadataByAssetId = {} as KeyringAssetMetadataByAssetId;
        for (const assetId of assetIds) {
          metadataByAssetId[assetId] =
            mockKeyringAssetMetadata[assetId] ?? null;
        }
        return metadataByAssetId;
      },
    );

    const accountAssetInfoService = new AccountAssetInfoService({
      logger,
      accountService,
      onChainAccountService,
      assetMetadataService,
    });

    handler = new GetAccountAssetInfoHandler({
      logger,
      accountAssetInfoService,
    });
  });

  it('returns metadata and trustline extra for a classic asset with limit', async () => {
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    onChainAccount.setAsset(USDC_CLASSIC as KnownCaip19ClassicAssetId, {
      balance: new BigNumber('0'),
      symbol: 'USDC',
      limit: new BigNumber('10000000'),
      authorized: true,
      sponsored: false,
      decimals: 7,
    });
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(onChainAccount);

    const result = (await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetAccountAssetInfo,
      params: {
        accountId: mockAccountId,
        scope,
        assets: [USDC_CLASSIC],
      },
    })) as GetAccountAssetInfoJsonRpcResponse;

    expect(result[USDC_CLASSIC]).toMatchObject({
      metadata: { symbol: 'USDC' },
      extra: {
        limit: '1',
        authorized: true,
        sponsored: false,
      },
    });
  });

  it('returns extra with zero limit for classic tombstone rows', async () => {
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    onChainAccount.setAsset(USDC_CLASSIC as KnownCaip19ClassicAssetId, {
      balance: new BigNumber('0'),
      symbol: 'USDC',
      limit: new BigNumber(0),
      decimals: 7,
    });
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(onChainAccount);

    const result = (await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetAccountAssetInfo,
      params: {
        accountId: mockAccountId,
        scope,
        assets: [USDC_CLASSIC],
      },
    })) as GetAccountAssetInfoJsonRpcResponse;

    expect(result[USDC_CLASSIC]?.extra).toStrictEqual({ limit: '0' });
  });

  it('omits extra when classic asset has no on-chain row', async () => {
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(onChainAccount);

    const result = (await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetAccountAssetInfo,
      params: {
        accountId: mockAccountId,
        scope,
        assets: [USDC_CLASSIC],
      },
    })) as GetAccountAssetInfoJsonRpcResponse;

    expect(result[USDC_CLASSIC]?.metadata).toBeDefined();
    expect(result[USDC_CLASSIC]?.extra).toBeUndefined();
  });

  it('tolerates unactivated accounts with null on-chain state', async () => {
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(null);

    const result = (await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetAccountAssetInfo,
      params: {
        accountId: mockAccountId,
        scope,
        assets: [USDC_CLASSIC],
      },
    })) as GetAccountAssetInfoJsonRpcResponse;

    expect(result[USDC_CLASSIC]?.metadata).toBeDefined();
    expect(result[USDC_CLASSIC]?.extra).toBeUndefined();
  });

  it('returns native slip44 metadata when on-chain account exists', async () => {
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 1.000001,
      },
    );
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(onChainAccount);

    const result = (await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetAccountAssetInfo,
      params: {
        accountId: mockAccountId,
        scope,
        assets: [slipId],
      },
    })) as GetAccountAssetInfoJsonRpcResponse;

    expect(result).toHaveProperty(slipId);
  });

  it('throws when asset info resolution fails', async () => {
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account: {
        id: mockAccountId,
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    } as Awaited<ReturnType<AccountService['resolveAccount']>>);
    jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockRejectedValue(new Error('Horizon unavailable'));

    await expect(
      handler.handle({
        jsonrpc: '2.0',
        id: 1,
        method: ClientRequestMethod.GetAccountAssetInfo,
        params: {
          accountId: mockAccountId,
          scope,
          assets: [USDC_CLASSIC],
        },
      }),
    ).rejects.toThrow(GetAccountAssetInfoException);
  });
});
