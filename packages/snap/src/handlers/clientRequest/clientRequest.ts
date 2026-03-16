import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import { MethodNotFoundError } from '@metamask/snaps-sdk';

import { ClientRequestMethod } from './api';
import { ChangeTrustHandler } from './changeTrustHandler';
import type { AccountService } from '../../services/account';
import type { WalletService } from '../../services/wallet/WalletService';
import { withCatchAndThrowSnapError } from '../../utils';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

export class ClientRequestHandler {
  readonly #logger: ILogger;

  readonly #changeTrustHandler: ChangeTrustHandler;

  constructor({
    logger,
    accountService,
    walletService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[👋 ClientRequestHandler]');
    this.#changeTrustHandler = new ChangeTrustHandler({
      logger,
      accountService,
      walletService,
    });
  }

  /**
   * Handles JSON-RPC requests originating exclusively from the client - as defined in [SIP-31](https://github.com/MetaMask/SIPs/blob/main/SIPS/sip-31.md) -
   * by routing them to the appropriate use case, based on the method. Some methods need to be implemented
   * as part of the [Unified Non-EVM Send](https://www.notion.so/metamask-consensys/Unified-Non-EVM-Send-248f86d67d6880278445f9ad75478471) specification.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   * @throws {MethodNotFoundError} If the method is not found.
   * @throws {InvalidParamsError} If the params are invalid.
   */
  async handle(request: JsonRpcRequest): Promise<Json> {
    this.#logger.log('Handling client request', request);

    const result =
      (await withCatchAndThrowSnapError(async () => {
        return this.#handleClientRequest(request);
      }, this.#logger)) ?? null;

    return result;
  }

  /**
   * Handles a client request by routing it to the appropriate use case, based on the method.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleClientRequest(request: JsonRpcRequest): Promise<Json> {
    const { method } = request;

    switch (method as ClientRequestMethod) {
      case ClientRequestMethod.SignChangeTrustline:
        return this.#changeTrustHandler.handle(request);
      default:
        throw new MethodNotFoundError() as Error;
    }
  }
}
