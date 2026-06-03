import type { Json } from '@metamask/utils';
import { ensureError } from '@metamask/utils';

import type {
  AccountAssetInfoExtra,
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse,
} from './api';
import {
  GetAccountAssetInfoJsonRpcRequestStruct,
  GetAccountAssetInfoJsonRpcResponseStruct,
} from './api';
import { BaseClientRequestHandler } from './base';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import type { AccountNotActivatedException } from '../../services/network/exceptions';
import type { OnChainAccount } from '../../services/on-chain-account';
import {
  createPrefixedLogger,
  isClassicAssetId,
  toDisplayBalance,
  type ILogger,
} from '../../utils';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE } from '../accountResolver';

class GetAccountAssetInfoException extends Error {
  constructor(accountId: string) {
    super(`Failed to get account asset info for account ${accountId}`);
    this.name = 'GetAccountAssetInfoException';
  }
}

export class GetAccountAssetInfoHandler extends BaseClientRequestHandler<
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse
> {
  readonly #logger: ILogger;

  #pendingRequest?: GetAccountAssetInfoJsonRpcRequest;

  constructor({
    logger,
    accountResolver,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[📦 GetAccountAssetInfoHandler]',
    );
    super({
      logger: prefixedLogger,
      accountResolver,
      requestStruct: GetAccountAssetInfoJsonRpcRequestStruct,
      responseStruct: GetAccountAssetInfoJsonRpcResponseStruct,
      resolveAccountOptions: RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
    });
    this.#logger = prefixedLogger;
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
   * Returns trust-line fields for requested Stellar classic assets.
   *
   * @param resolved - Keyring account and persisted on-chain snapshot.
   * @param request - JSON-RPC request with accountId, scope, and assets.
   * @returns Per-asset trust-line fields keyed by classic asset id.
   */
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: GetAccountAssetInfoJsonRpcRequest,
  ): Promise<GetAccountAssetInfoJsonRpcResponse> {
    const { assets } = request.params;
    return this.#buildAccountAssetInfoResponse(
      resolved.account.id,
      assets,
      resolved.onChainAccount,
    );
  }

  /**
   * Returns empty trust-line entries when the account is not activated.
   * Tolerates unactivated accounts for portfolio-import UX instead of showing the activation prompt.
   *
   * @param _error - The account not activated error.
   * @returns Per-asset trust-line fields without on-chain data.
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
    const { accountId, assets } = request.params;
    return this.#buildAccountAssetInfoResponse(accountId, assets, null);
  }

  async #buildAccountAssetInfoResponse(
    accountId: string,
    assets: KnownCaip19AssetIdOrSlip44Id[],
    onChainAccount: OnChainAccount | null,
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, AccountAssetInfoExtra>> {
    const result = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AccountAssetInfoExtra
    >;

    try {
      for (const assetId of assets) {
        if (!isClassicAssetId(assetId)) {
          continue;
        }

        const assetData =
          onChainAccount === null
            ? undefined
            : onChainAccount.getRawAsset(assetId);

        if (assetData?.limit === undefined) {
          result[assetId] = {};
          continue;
        }

        const decimals = assetData.decimals ?? STELLAR_DECIMAL_PLACES;
        result[assetId] = {
          limit: toDisplayBalance(assetData.limit, decimals),
          ...(assetData.authorized === undefined
            ? {}
            : { authorized: assetData.authorized }),
          ...(assetData.sponsored === undefined
            ? {}
            : { sponsored: assetData.sponsored }),
        };
      }

      return result;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to get account asset info',
        ensureError(error).message,
      );
      throw new GetAccountAssetInfoException(accountId);
    }
  }
}
