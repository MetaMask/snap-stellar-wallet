import { MethodNotFoundError } from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';

import type { ILogger } from '../utils';
import { createPrefixedLogger, validateOrigin } from '../utils';

export class RpcHandler {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[👋 RpcHandler]');
  }

  async handle(origin: string, request: JsonRpcRequest): Promise<Json> {
    validateOrigin(origin, request.method);

    this.#logger.info('Handling RPC request', request);

    const { method } = request;

    switch (method) {
      default:
        throw new MethodNotFoundError() as Error;
    }
  }
}
