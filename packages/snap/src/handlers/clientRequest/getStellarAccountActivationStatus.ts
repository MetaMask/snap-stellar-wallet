import type {
  GetStellarAccountActivationStatusJsonRpcRequest,
  GetStellarAccountActivationStatusJsonRpcResponse,
} from './api';
import {
  GetStellarAccountActivationStatusJsonRpcRequestStruct,
  GetStellarAccountActivationStatusJsonRpcResponseStruct,
} from './api';
import type { AccountService } from '../../services/account';
import type { NetworkService } from '../../services/network';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import { BaseHandler } from '../base';

export class GetStellarAccountActivationStatusHandler extends BaseHandler<
  GetStellarAccountActivationStatusJsonRpcRequest,
  GetStellarAccountActivationStatusJsonRpcResponse
> {
  readonly #accountService: AccountService;

  readonly #networkService: NetworkService;

  constructor({
    logger,
    accountService,
    networkService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    networkService: NetworkService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[GetStellarAccountActivationStatusHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: GetStellarAccountActivationStatusJsonRpcRequestStruct,
      responseStruct: GetStellarAccountActivationStatusJsonRpcResponseStruct,
    });
    this.#accountService = accountService;
    this.#networkService = networkService;
  }

  /**
   * Returns whether the account exists on Horizon for the requested network scope.
   *
   * @param request - JSON-RPC request with `accountId` and `scope`.
   * @returns `{ activated: true }` when Horizon has the account; `false` when missing / not funded on-ledger.
   */
  protected async handleRequest(
    request: GetStellarAccountActivationStatusJsonRpcRequest,
  ): Promise<GetStellarAccountActivationStatusJsonRpcResponse> {
    const { accountId, scope } = request.params;

    const { account } = await this.#accountService.resolveAccount({
      accountId,
    });

    const onChain = await this.#networkService.getAccountOrNull(
      account.address,
      scope,
    );

    return { activated: onChain !== null };
  }
}
