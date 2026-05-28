import type { Json, JsonRpcRequest } from '@metamask/utils';

import type {
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse,
} from './api';
import {
  GetAccountAssetInfoJsonRpcRequestStruct,
  GetAccountAssetInfoJsonRpcResponseStruct,
} from './api';
import type { IClientRequestHandler } from './base';
import type { AccountAssetInfoService } from '../../services/account-asset-info';
import { createPrefixedLogger, type ILogger } from '../../utils/logger';
import { BaseHandler } from '../base';

export class GetAccountAssetInfoHandler
  extends BaseHandler<
    GetAccountAssetInfoJsonRpcRequest,
    GetAccountAssetInfoJsonRpcResponse
  >
  implements IClientRequestHandler
{
  readonly #accountAssetInfoService: AccountAssetInfoService;

  constructor({
    logger,
    accountAssetInfoService,
  }: {
    logger: ILogger;
    accountAssetInfoService: AccountAssetInfoService;
  }) {
    super({
      logger: createPrefixedLogger(logger, '[📦 GetAccountAssetInfoHandler]'),
      requestStruct: GetAccountAssetInfoJsonRpcRequestStruct,
      responseStruct: GetAccountAssetInfoJsonRpcResponseStruct,
    });
    this.#accountAssetInfoService = accountAssetInfoService;
  }

  /**
   * Returns fungible metadata and optional trust-line fields for the requested assets.
   * Tolerates unactivated accounts (no on-chain row) for portfolio-import UX.
   *
   * @param request - JSON-RPC request with accountId, scope, and assets.
   * @returns Per-asset metadata and optional trust-line extra fields.
   */
  protected async handleRequest(
    request: GetAccountAssetInfoJsonRpcRequest,
  ): Promise<GetAccountAssetInfoJsonRpcResponse> {
    const { accountId, scope, assets } = request.params;
    return this.#accountAssetInfoService.getAccountAssetInfo({
      accountId,
      scope,
      assets,
    });
  }

  async handle(
    request: GetAccountAssetInfoJsonRpcRequest | JsonRpcRequest | Json,
  ): Promise<GetAccountAssetInfoJsonRpcResponse | Json> {
    return super.handle(request);
  }
}
