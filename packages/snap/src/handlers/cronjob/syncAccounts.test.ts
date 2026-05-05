import { BackgroundEventMethod } from './api';
import { SyncAccountsHandler } from './syncAccounts';
import { AppConfig } from '../../config';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import { generateMockStellarKeyringAccounts } from '../../services/account/__mocks__/account.fixtures';
import type { OnChainAccountService } from '../../services/on-chain-account';
import { Duration } from '../../utils';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('SyncAccountsHandler', () => {
  const mockEntropySourceId = 'entropy-source-1';
  const [firstAccount, secondAccount] = generateMockStellarKeyringAccounts(
    2,
    mockEntropySourceId,
  ) as [StellarKeyringAccount, StellarKeyringAccount];

  const setupTest = () => {
    const accountService: jest.Mocked<
      Pick<AccountService, 'getAllSelected' | 'findByIds'>
    > = {
      getAllSelected: jest.fn(),
      findByIds: jest.fn(),
    };
    const onChainAccountService: jest.Mocked<
      Pick<OnChainAccountService, 'synchronize'>
    > = {
      synchronize: jest.fn(),
    };

    const handler = new SyncAccountsHandler({
      logger,
      accountService: accountService as unknown as AccountService,
      onChainAccountService:
        onChainAccountService as unknown as OnChainAccountService,
    });

    return {
      handler,
      accountService,
      onChainAccountService,
    };
  };

  it('schedules background event for selected accounts with default duration', async () => {
    await SyncAccountsHandler.scheduleBackgroundEvent({
      accountIds: 'selected',
    });

    expect(snap.request).toHaveBeenCalledWith({
      method: 'snap_scheduleBackgroundEvent',
      params: {
        duration: Duration.OneSecond,
        request: {
          method: BackgroundEventMethod.SynchronizeAccounts,
          params: {
            accountIds: 'selected',
          },
        },
      },
    });
  });

  it('schedules background event with the provided duration', async () => {
    const accountIds = [firstAccount.id];

    await SyncAccountsHandler.scheduleBackgroundEvent(
      { accountIds },
      Duration.FiveSeconds,
    );

    expect(snap.request).toHaveBeenCalledWith({
      method: 'snap_scheduleBackgroundEvent',
      params: {
        duration: Duration.FiveSeconds,
        request: {
          method: BackgroundEventMethod.SynchronizeAccounts,
          params: {
            accountIds,
          },
        },
      },
    });
  });

  it('synchronizes selected accounts when accountIds is `selected`', async () => {
    const { handler, accountService, onChainAccountService } = setupTest();
    const selectedAccounts = [firstAccount, secondAccount];
    accountService.getAllSelected.mockResolvedValue(selectedAccounts);

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.SynchronizeAccounts,
      params: { accountIds: 'selected' },
    };

    await handler.handle(request);

    expect(accountService.getAllSelected).toHaveBeenCalledTimes(1);
    expect(accountService.findByIds).not.toHaveBeenCalled();
    expect(onChainAccountService.synchronize).toHaveBeenCalledWith(
      selectedAccounts,
      AppConfig.selectedNetwork,
    );
  });

  it('synchronizes accounts fetched by ids when accountIds is an array of account ids', async () => {
    const { handler, accountService, onChainAccountService } = setupTest();
    const accountIds = [firstAccount.id, secondAccount.id];
    const accountsByIds = [firstAccount];
    accountService.findByIds.mockResolvedValue(accountsByIds);

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.SynchronizeAccounts,
      params: { accountIds },
    };

    await handler.handle(request);

    expect(accountService.findByIds).toHaveBeenCalledWith(accountIds);
    expect(accountService.getAllSelected).not.toHaveBeenCalled();
    expect(onChainAccountService.synchronize).toHaveBeenCalledWith(
      accountsByIds,
      AppConfig.selectedNetwork,
    );
  });
});
