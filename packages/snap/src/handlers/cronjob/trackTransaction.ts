import type {
  TrackTransactionJsonRpcRequest,
  TrackTransactionParams,
} from './api';
import {
  BackgroundEventMethod,
  TrackTransactionJsonRpcRequestStruct,
} from './api';
import { CronjobBaseHandler } from './base';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import { scheduleBackgroundEvent } from '../../utils/snap';

export class TrackTransactionHandler extends CronjobBaseHandler<TrackTransactionJsonRpcRequest> {
  static readonly duration = 'PT1S';

  static async scheduleBackgroundEvent(
    params: TrackTransactionParams,
    duration: string = TrackTransactionHandler.duration,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.RefreshConfirmationPrices,
      params,
      duration,
    });
  }

  constructor({ logger }: { logger: ILogger }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[TrackTransactionHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: TrackTransactionJsonRpcRequestStruct,
    });
  }

  async handleCronJobRequest(
    _request: TrackTransactionJsonRpcRequest,
  ): Promise<void> {
    // TODO: Implement transaction tracking.
    this.logger.info('Tracking transaction...');
  }
}
