import type { Struct } from '@metamask/superstruct';
import type { Json, JsonRpcRequest } from '@metamask/utils';

import type { ILogger } from '../utils';
import { serializeToString, validateRequest, validateResponse } from '../utils';

export abstract class BaseHandler<
  RequestType extends Json,
  ResponseType extends Json,
> {
  protected readonly requestStruct: Struct<RequestType>;

  protected readonly responseStruct: Struct<ResponseType>;

  protected readonly logger: ILogger;

  constructor({
    logger,
    requestStruct,
    responseStruct,
  }: {
    logger: ILogger;
    requestStruct: Struct<RequestType>;
    responseStruct: Struct<ResponseType>;
  }) {
    this.logger = logger;
    this.requestStruct = requestStruct;
    this.responseStruct = responseStruct;
  }

  protected abstract handleRequest(
    request: RequestType,
  ): Promise<ResponseType | Json>;

  /**
   * Handles a JSON-RPC request by resolving an activated account and calling the _handle method.
   *
   * @param request - The JSON-RPC request to handle.
   * @returns The result of the _handle method.
   */
  async handle(
    request: RequestType | JsonRpcRequest | Json,
  ): Promise<ResponseType | Json> {
    this.logger.debug('Handling request', {
      request: serializeToString({ value: request }),
    });

    const validatedRequest = validateRequest(request, this.requestStruct);

    this.logger.debug(`Starting handle transformed request`, {
      request: serializeToString({ value: validatedRequest }),
    });

    const result = await this.handleRequest(validatedRequest);

    this.logger.debug('Handled request', {
      result: serializeToString({ value: result }),
    });

    validateResponse(result, this.responseStruct);

    return result;
  }
}
