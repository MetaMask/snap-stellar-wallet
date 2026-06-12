import { SynchronizeService } from './SynchronizeService';
import { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { logger } from '../../utils/logger';
import type { StellarKeyringAccount } from '../account';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/account.fixtures';
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
    const service = new SynchronizeService({
      logger,
      onChainAccountService,
      transactionService,
    });

    return {
      service,
      onChainAccountService,
      transactionService,
      onChainSynchronizeSpy: jest.spyOn(onChainAccountService, 'synchronize'),
      transactionSynchronizeSpy: jest.spyOn(transactionService, 'synchronize'),
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
    } = setup();

    await service.synchronize([]);

    expect(resolveOnChainAccountSpy).not.toHaveBeenCalled();
    expect(onChainSynchronizeSpy).not.toHaveBeenCalled();
    expect(transactionSynchronizeSpy).not.toHaveBeenCalled();
  });

  it('synchronizes activated accounts and transactions for funded accounts', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
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

    expect(onChainSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
    );
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith(
      [{ keyringAccount: account, onChainAccount }],
      scope,
    );
  });

  it('skips unfunded accounts without failing the sync', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
    } = setup();
    const [account] = generateMockStellarKeyringAccounts(
      1,
      'sync-unfunded-entropy',
    ) as [StellarKeyringAccount];

    resolveOnChainAccountSpy.mockRejectedValue(
      new AccountNotActivatedException(account.address, scope),
    );

    await service.synchronize([account], { scope });

    expect(onChainSynchronizeSpy).toHaveBeenCalledWith([], scope);
    expect(transactionSynchronizeSpy).toHaveBeenCalledWith([], scope);
  });

  it('respects syncAccounts and syncTransactions options', async () => {
    const {
      service,
      onChainSynchronizeSpy,
      transactionSynchronizeSpy,
      resolveOnChainAccountSpy,
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
    );
  });
});
