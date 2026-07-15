import type { SyncAccountJsonRpcRequest, SyncAccountParams } from './api';
import { BackgroundEventMethod, SyncAccountJsonRpcRequestStruct } from './api';
import { CronjobBaseHandler } from './base';
import { AppConfig } from '../../config';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { SynchronizeService } from '../../services/sync/SynchronizeService';
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

  readonly #synchronizeService: SynchronizeService;

  readonly #accountService: AccountService;

  constructor({
    logger,
    synchronizeService,
    accountService,
  }: {
    logger: ILogger;
    synchronizeService: SynchronizeService;
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
    this.#synchronizeService = synchronizeService;
    this.#accountService = accountService;
  }

  /**
   * Omit declarative `request.params` for this cron job in `snap.manifest.json`.
   * Grant-time validation uses superstruct `JsonStruct` on caveat values that can
   * be frozen/Immer-sealed; with `params: { accountIds: 'selected' }` validation
   * threw: "Cannot assign to read only property 'accountIds'…", while
   * `JSON.parse(JSON.stringify(jobs))` validated successfully (same logical shape).
   * Omitted params mean "selected accounts" here.
   *
   * @param request - Cron JSON-RPC request (params may be omitted or `{}`).
   */
  protected async handleCronJobRequest(
    request: SyncAccountJsonRpcRequest,
  ): Promise<void> {
    const scope = AppConfig.selectedNetwork;
    const accountIds = request.params?.accountIds ?? ('selected' as const);

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

    await this.#synchronizeService.synchronize(accounts, { scope });
  }
}
