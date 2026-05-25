import type { Json, JsonRpcRequest } from '@metamask/utils';

import type {
  OnAddressInputJsonRpcRequest,
  OnAddressInputJsonRpcResponse,
} from './api';
import {
  MultiChainSendErrorCodes,
  OnAddressInputJsonRpcRequestStruct,
} from './api';
import type { IClientRequestHandler } from './base';
import type { ILogger } from '../../utils';
import { createPrefixedLogger, validateRequest } from '../../utils';

export class OnAddressInputHandler implements IClientRequestHandler {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[📮 OnAddressInputHandler]',
    );
    this.#logger = prefixedLogger;
  }

  /**
   * Handles the input of an address.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @param request.params.value - The address to validate.
   * @returns The response to the JSON-RPC request.
   */
  async handle(
    request: OnAddressInputJsonRpcRequest | JsonRpcRequest,
  ): Promise<OnAddressInputJsonRpcResponse | Json> {
    try {
      validateRequest(request, OnAddressInputJsonRpcRequestStruct);
      return {
        valid: true,
        errors: [],
      };
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Invalid address', error);
      return {
        valid: false,
        errors: [{ code: MultiChainSendErrorCodes.Invalid }],
      };
    }
  }
}
