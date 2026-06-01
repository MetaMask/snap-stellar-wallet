import type { Json, JsonRpcRequest } from '@metamask/utils';

import type {
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse,
} from './api';
import {
  GetAccountAssetInfoJsonRpcRequestStruct,
  GetAccountAssetInfoJsonRpcResponseStruct,
} from './api';
import { BaseClientRequestHandler } from './base';
import type { AccountAssetInfoService } from '../../services/account-asset-info';
import type { AccountNotActivatedException } from '../../services/network/exceptions';
import { createPrefixedLogger, type ILogger } from '../../utils/logger';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE } from '../accountResolver';

export class GetAccountAssetInfoHandler extends BaseClientRequestHandler<
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse
> {
  readonly #accountAssetInfoService: AccountAssetInfoService;

  #pendingRequest?: GetAccountAssetInfoJsonRpcRequest;

  constructor({
    logger,
    accountResolver,
    accountAssetInfoService,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    accountAssetInfoService: AccountAssetInfoService;
  }) {
    super({
      logger: createPrefixedLogger(logger, '[📦 GetAccountAssetInfoHandler]'),
      accountResolver,
      requestStruct: GetAccountAssetInfoJsonRpcRequestStruct,
      responseStruct: GetAccountAssetInfoJsonRpcResponseStruct,
      resolveAccountOptions: RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
    });
    this.#accountAssetInfoService = accountAssetInfoService;
  }

  protected override async handleRequest(
    request: GetAccountAssetInfoJsonRpcRequest,
  ): Promise<GetAccountAssetInfoJsonRpcResponse | Json> {
    this.#pendingRequest = request;
    try {
      return await super.handleRequest(request);
    } finally {
      this.#pendingRequest = undefined;
    }
  }

  /**
   * Returns fungible metadata and optional trust-line fields for the requested assets.
   *
   * @param resolved - Keyring account and persisted on-chain snapshot.
   * @param request - JSON-RPC request with accountId, scope, and assets.
   * @returns Per-asset metadata and optional trust-line extra fields.
   */
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: GetAccountAssetInfoJsonRpcRequest,
  ): Promise<GetAccountAssetInfoJsonRpcResponse> {
    const { scope, assets } = request.params;
    return this.#accountAssetInfoService.getAccountAssetInfo({
      accountId: resolved.account.id,
      scope,
      assets,
      onChainAccount: resolved.onChainAccount,
    });
  }

  /**
   * Returns fungible metadata without trust-line extras when the account is not activated.
   * Tolerates unactivated accounts for portfolio-import UX instead of showing the activation prompt.
   *
   * @param _error - The account not activated error.
   * @returns Per-asset metadata without on-chain trust-line fields.
   */
  protected override async handleAccountNotActivatedError(
    _error: AccountNotActivatedException,
  ): Promise<GetAccountAssetInfoJsonRpcResponse> {
    const request = this.#pendingRequest;
    if (request === undefined) {
      throw new Error(
        'Missing request context for unactivated account handling',
      );
    }
    const { accountId, scope, assets } = request.params;
    return this.#accountAssetInfoService.getAccountAssetInfo({
      accountId,
      scope,
      assets,
      onChainAccount: null,
    });
  }

  async handle(
    request: GetAccountAssetInfoJsonRpcRequest | JsonRpcRequest | Json,
  ): Promise<GetAccountAssetInfoJsonRpcResponse | Json> {
    return super.handle(request);
  }
}
