import { BigNumber } from 'bignumber.js';

import type { GetAccountAssetInfoJsonRpcResponse } from './api';
import { ClientRequestMethod } from './api';
import { GetAccountAssetInfoHandler } from './getAccountAssetInfo';
import { type KnownCaip19ClassicAssetId, KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { USDC_CLASSIC } from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { OnChainAccountService } from '../../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
  type MockAccountWithBalancesData,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../../services/on-chain-account/OnChainAccount';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { getSlip44AssetId } from '../../utils';
import { logger } from '../../utils/logger';
import { AccountResolver } from '../accountResolver';

jest.mock('../../utils/logger');
jest.mock('../../ui/confirmation/views/AccountActivationPrompt/render', () => ({
  render: jest.fn().mockResolvedValue(undefined),
}));

describe('GetAccountAssetInfoHandler', () => {
  const mockAccountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;

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

  function setup() {
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      mockAccountId,
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      'entropy-source-1',
      0,
    );

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account,
    });
    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);
    const resolveOnChainAccountByKeyringAccountIdSpy = jest.spyOn(
      OnChainAccountService.prototype,
      'resolveOnChainAccountByKeyringAccountId',
    );

    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });

    const handler = new GetAccountAssetInfoHandler({
      logger,
      accountResolver,
    });

    return {
      handler,
      resolveOnChainAccountByKeyringAccountIdSpy,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns trustline fields for a classic asset with limit', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
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
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(
      onChainAccount,
    );

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

    expect(result[USDC_CLASSIC]).toStrictEqual({
      limit: '1',
      authorized: true,
      sponsored: false,
    });
  });

  it('returns zero limit for classic tombstone rows', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    onChainAccount.setAsset(USDC_CLASSIC as KnownCaip19ClassicAssetId, {
      balance: new BigNumber('0'),
      symbol: 'USDC',
      limit: new BigNumber(0),
      decimals: 7,
    });
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(
      onChainAccount,
    );

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

    expect(result[USDC_CLASSIC]).toStrictEqual({ limit: '0' });
  });

  it('returns empty trustline entry when classic asset has no on-chain row', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(
      onChainAccount,
    );

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

    expect(result[USDC_CLASSIC]).toStrictEqual({});
  });

  it('tolerates unactivated accounts with null on-chain state', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(null);

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

    expect(result[USDC_CLASSIC]).toStrictEqual({});
  });

  it('returns baseReserve extra for native XLM', async () => {
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    const onChainAccount = createTestOnChainAccount(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 1.000001,
        subentryCount: 3,
      },
    );
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(
      onChainAccount,
    );

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

    expect(result[slipId]).toStrictEqual({
      baseReserve: '2.5',
    });
  });

  it('returns empty entry for native XLM when account is not activated', async () => {
    const slipId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(null);

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

    expect(result[slipId]).toStrictEqual({});
  });

  it('throws when on-chain account resolution fails', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy } = setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockRejectedValue(
      new Error('Horizon unavailable'),
    );

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
    ).rejects.toThrow('Horizon unavailable');
  });
});
