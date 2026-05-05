import type { SyncAccountJsonRpcRequest, SyncAccountParams } from './api';
import { BackgroundEventMethod, SyncAccountJsonRpcRequestStruct } from './api';
import { CronjobBaseHandler } from './base';
import { AppConfig } from '../../config';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import { Duration, scheduleBackgroundEvent } from '../../utils';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

export class SyncAccountsHandler extends CronjobBaseHandler<SyncAccountJsonRpcRequest> {
  static async scheduleBackgroundEvent(
    params: SyncAccountParams,
    duration: Duration = Duration.OneSecond,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.SynchronizeAccounts,
      params,
      duration,
    });
  }

  readonly #onChainAccountService: OnChainAccountService;

  readonly #accountService: AccountService;

  constructor({
    logger,
    onChainAccountService,
    accountService,
  }: {
    logger: ILogger;
    onChainAccountService: OnChainAccountService;
    accountService: AccountService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[SyncAccountsHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: SyncAccountJsonRpcRequestStruct,
    });
    this.#onChainAccountService = onChainAccountService;
    this.#accountService = accountService;
  }

  protected async handleCronJobRequest(
    request: SyncAccountJsonRpcRequest,
  ): Promise<void> {
    const scope = AppConfig.selectedNetwork;
    const {
      params: { accountIds },
    } = request;

    let accounts: StellarKeyringAccount[] = [];
    if (accountIds === 'selected') {
      this.logger.debug('Synchronizing selected accounts');
      accounts = await this.#accountService.getAllSelected();
    } else {
      this.logger.debug('Synchronizing accounts by IDs', {
        accountIds,
      });
      accounts = await this.#accountService.findByIds(accountIds);
    }

    await this.#onChainAccountService.synchronize(accounts, scope);
  }
}
