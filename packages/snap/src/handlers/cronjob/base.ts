import type { Struct } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import { BaseHandler } from '../base';
import type { CrobJobJsonRpcRequest } from './api';
import { CrobJobJsonRpcRequestStruct } from './api';
import type { ILogger } from '../../utils';

export abstract class CronjobBaseHandler<
  RequestType extends Json,
> extends BaseHandler<RequestType, CrobJobJsonRpcRequest> {
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
      responseStruct: CrobJobJsonRpcRequestStruct,
    });
  }

  protected async handleRequest(request: RequestType): Promise<Json> {
    await this.handleCronJobRequest(request);
    return {
      status: true,
    };
  }

  abstract handleCronJobRequest(request: RequestType): Promise<void>;
}
