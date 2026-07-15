import { SynchronizeService } from './SynchronizeService';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { logger } from '../../utils/logger';
import type { StellarKeyringAccount } from '../account';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/account.fixtures';
import { AssetMetadataService } from '../asset-metadata';
import {
  createMockAssetMetadataService,
  getMockSep41Assets,
} from '../asset-metadata/__mocks__/assets.fixtures';
import { AccountNotActivatedException } from '../network';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from '../on-chain-account/__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from '../on-chain-account/OnChainAccount';
import { createMockTransactionService } from '../transaction/__mocks__/transaction.fixtures';

jest.mock('../../utils/logger');

describe('SynchronizeService', () => {
  const scope = KnownCaip2ChainId.Mainnet;

  const setup = () => {
    const { onChainAccountService } = mockOnChainAccountService();
    const { transactionService } = createMockTransactionService();
    const { service: assetMetadataService } = createMockAssetMetadataService();
    const sep41Assets = getMockSep41Assets();
    const fetchSep41AssetsOrSyncOnceSpy = jest
      .spyOn(AssetMetadataService.prototype, 'fetchSep41AssetsOrSyncOnce')
      .mockResolvedValue(sep41Assets);
    const service = new SynchronizeService({
      logger,
      onChainAccountService,
      assetMetadataService,
      transactionService,
    });

    return {
      service,
      onChainAccountService,
      transactionService,
      assetMetadataService,
      sep41Assets,
      fetchSep41AssetsOrSyncOnceSpy,
      onChainSynchronizeSpy: jest
        .spyOn(onChainAccountService, 'synchronize')
        .mockResolvedValue(undefined),
      transactionSynchronizeSpy: jest
        .spyOn(transactionService, 'synchronize')
        .mockResolvedValue(undefined),
      resolveOnChainAccountSpy: jest.spyOn(
        onChainAccountService,
        'resolveOnChainAccount',
      ),
    };
  };

  it('returns early when no accounts are provided', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      fetchSep41AssetsOrSyncOnceSpy,
    } = setup();

    await service.synchronize([]);

    expect(resolveOnChainAccountSpy).not.toHaveBeenCalled();
    expect(fetchSep41AssetsOrSyncOnceSpy).not.toHaveBeenCalled();
    expect(onChainSynchronizeSpy).not.toHaveBeenCalled();
    expect(transactionSynchronizeSpy).not.toHaveBeenCalled();
  });

  it('synchronizes activated accounts and transactions for funded accounts', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      fetchSep41AssetsOrSyncOnceSpy,
      sep41Assets,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-service-entropy',
    ) as [StellarKeyringAccount];
    const onChainAccount = new OnChainAccount(
      createMockAccountWithBalances(account.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 10,
      }),
      scope,
      horizonSource(
        createMockAccountWithBalances(account.address, '1', {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 10,
        }),
        scope,
      ),
    );

    resolveOnChainAccountSpy.mockResolvedValue(onChainAccount);

    await service.synchronize([account], {
      scope,
      syncAccounts: true,
      syncTransactions: true,
    });

    expect(fetchSep41AssetsOrSyncOnceSpy).toHaveBeenCalledWith(scope);
    expect(onChainSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      sep41Assets,
    );
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      sep41Assets,
    );
  });

  it('skips unfunded accounts without failing the sync', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      sep41Assets,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-unfunded-entropy',
    ) as [StellarKeyringAccount];

    resolveOnChainAccountSpy.mockRejectedValue(
      new AccountNotActivatedException(account.address, scope),
    );

    await service.synchronize([account], { scope });

    expect(onChainSynchronizeSpy).toHaveBeenCalledWith([], scope, sep41Assets);
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [],
      scope,
      sep41Assets,
    );
  });

  it('respects syncAccounts and syncTransactions options', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      sep41Assets,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-options-entropy',
    ) as [StellarKeyringAccount];
    const onChainAccount = new OnChainAccount(
      createMockAccountWithBalances(account.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 10,
      }),
      scope,
      horizonSource(
        createMockAccountWithBalances(account.address, '1', {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 10,
        }),
        scope,
      ),
    );

    resolveOnChainAccountSpy.mockResolvedValue(onChainAccount);

    await service.synchronize([account], {
      scope: AppConfig.selectedNetwork,
      syncAccounts: false,
      syncTransactions: true,
    });

    expect(onChainSynchronizeSpy).not.toHaveBeenCalled();
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      AppConfig.selectedNetwork,
      sep41Assets,
    );
  });

  it('continues sync when SEP-41 asset loading fails', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      fetchSep41AssetsOrSyncOnceSpy,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-sep41-failure-entropy',
    ) as [StellarKeyringAccount];
    const onChainAccount = new OnChainAccount(
      createMockAccountWithBalances(account.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 10,
      }),
      scope,
      horizonSource(
        createMockAccountWithBalances(account.address, '1', {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 10,
        }),
        scope,
      ),
    );

    fetchSep41AssetsOrSyncOnceSpy.mockRejectedValue(
      new Error('token api down'),
    );
    resolveOnChainAccountSpy.mockResolvedValue(onChainAccount);

    await service.synchronize([account], { scope });

    expect(onChainSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      [],
    );
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      [],
    );
  });

  it('continues sync when account synchronization fails', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
      sep41Assets,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-account-failure-entropy',
    ) as [StellarKeyringAccount];
    const onChainAccount = new OnChainAccount(
      createMockAccountWithBalances(account.address, '1', {
        ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        nativeBalance: 10,
      }),
      scope,
      horizonSource(
        createMockAccountWithBalances(account.address, '1', {
          ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          nativeBalance: 10,
        }),
        scope,
      ),
    );

    resolveOnChainAccountSpy.mockResolvedValue(onChainAccount);
    onChainSynchronizeSpy.mockRejectedValue(new Error('account sync failed'));

    await service.synchronize([account], { scope });

    expect(onChainSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      sep41Assets,
    );
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
      sep41Assets,
    );
  });

  it('delegates asset synchronization to AssetMetadataService', async () => {
    const { service, assetMetadataService } = setup();
    const synchronizeSpy = jest
      .spyOn(assetMetadataService, 'synchronize')
      .mockResolvedValue(undefined);

    await service.synchronizeAssets(scope);

    expect(synchronizeSpy).toHaveBeenCalledWith(scope);
  });

  it('logs and does not throw when asset synchronization fails', async () => {
    const { service, assetMetadataService } = setup();
    const synchronizeSpy = jest
      .spyOn(assetMetadataService, 'synchronize')
      .mockRejectedValue(new Error('token api down'));

    await service.synchronizeAssets(scope);

    expect(synchronizeSpy).toHaveBeenCalledWith(scope);
  });
});
