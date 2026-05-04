import type { Struct } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import { BaseHandler } from '../base';
import type { CronjobJsonRpcRequest } from './api';
import { CronjobJsonRpcRequestStruct } from './api';
import type { ILogger } from '../../utils';

export abstract class CronjobBaseHandler<
  RequestType extends Json,
> extends BaseHandler<RequestType, CronjobJsonRpcRequest> {
  constructor({
    logger,
    requestStruct,
  }: {
    logger: ILogger;
    requestStruct: Struct<RequestType>;
  }) {
    super({
      logger,
      requestStruct,
      responseStruct: CronjobJsonRpcRequestStruct,
    });
  }

  protected async handleRequest(request: RequestType): Promise<Json> {
    await this.handleCronJobRequest(request);
    return {
      status: true,
    };
  }

  protected abstract handleCronJobRequest(request: RequestType): Promise<void>;
}
