import type { SyncAssetsJsonRpcRequest } from './api';
import { SyncAssetsJsonRpcRequestStruct } from './api';
import { CronjobBaseHandler } from './base';
import { KnownCaip2ChainId } from '../../api';
import type { SynchronizeService } from '../../services/sync/SynchronizeService';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

export class SyncAssetsHandler extends CronjobBaseHandler<SyncAssetsJsonRpcRequest> {
  readonly #synchronizeService: SynchronizeService;

  constructor({
    logger,
    synchronizeService,
  }: {
    logger: ILogger;
    synchronizeService: SynchronizeService;
  }) {
    const prefixedLogger = createPrefixedLogger(logger, '[SyncAssetsHandler]');
    super({
      logger: prefixedLogger,
      requestStruct: SyncAssetsJsonRpcRequestStruct,
    });
    this.#synchronizeService = synchronizeService;
  }

  /**
   * Declarative cron job with no `request.params` in `snap.manifest.json`.
   * Asset metadata is only available on mainnet, so synchronization always uses
   * mainnet scope regardless of the user's selected network.
   *
   * @param _request - Cron JSON-RPC request (method only).
   */
  protected async handleCronJobRequest(
    _request: SyncAssetsJsonRpcRequest,
  ): Promise<void> {
    const scope = KnownCaip2ChainId.Mainnet;
    await this.#synchronizeService.synchronizeAssets(scope);
  }
}
