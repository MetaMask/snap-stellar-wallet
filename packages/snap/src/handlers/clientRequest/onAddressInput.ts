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
import { validateRequest } from '../../utils';

export class OnAddressInputHandler implements IClientRequestHandler {
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
    } catch {
      // validateRequest will only throw InvalidParamsError,
      // so we can safely ignore the error.
      return {
        valid: false,
        errors: [{ code: MultiChainSendErrorCodes.Invalid }],
      };
    }
  }
}
