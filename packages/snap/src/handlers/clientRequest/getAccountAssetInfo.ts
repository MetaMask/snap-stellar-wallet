import { FungibleAssetMetadataStruct } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';
import { ensureError } from '@metamask/utils';

import type {
  AccountAssetInfoEntry,
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse,
} from './api';
import {
  GetAccountAssetInfoJsonRpcRequestStruct,
  GetAccountAssetInfoJsonRpcResponseStruct,
} from './api';
import { BaseClientRequestHandler } from './base';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import type { AssetMetadataService } from '../../services/asset-metadata/AssetMetadataService';
import type { AccountNotActivatedException } from '../../services/network/exceptions';
import type { OnChainAccount } from '../../services/on-chain-account';
import {
  createPrefixedLogger,
  isClassicAssetId,
  isSep41Id,
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
  readonly #assetMetadataService: AssetMetadataService;

  readonly #logger: ILogger;

  #pendingRequest?: GetAccountAssetInfoJsonRpcRequest;

  constructor({
    logger,
    accountResolver,
    assetMetadataService,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    assetMetadataService: AssetMetadataService;
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
    this.#assetMetadataService = assetMetadataService;
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
    const { assets } = request.params;
    return this.#buildAccountAssetInfoResponse(
      resolved.account.id,
      assets,
      resolved.onChainAccount,
    );
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
    const { accountId, assets } = request.params;
    return this.#buildAccountAssetInfoResponse(accountId, assets, null);
  }

  async #buildAccountAssetInfoResponse(
    accountId: string,
    assets: KnownCaip19AssetIdOrSlip44Id[],
    onChainAccount: OnChainAccount | null,
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, AccountAssetInfoEntry>> {
    const result = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AccountAssetInfoEntry
    >;

    try {
      const assetsMetadata =
        await this.#assetMetadataService.getAssetsMetadataByAssetIds(assets);

      for (const assetId of assets) {
        const assetMetadata = assetsMetadata[assetId];
        if (
          assetMetadata === undefined ||
          assetMetadata === null ||
          !FungibleAssetMetadataStruct.is(assetMetadata) ||
          assetMetadata.units[0]?.decimals === undefined
        ) {
          continue;
        }

        const onChainRow =
          onChainAccount === null
            ? undefined
            : onChainAccount.getAsset(assetId);

        if (isSep41Id(assetId) && !onChainRow?.balance.gt(0)) {
          continue;
        }

        const { decimals } = assetMetadata.units[0];
        const onChainRowForExtra =
          onChainAccount === null || !isClassicAssetId(assetId)
            ? onChainRow
            : onChainAccount.getRawAsset(assetId);

        let extra: AccountAssetInfoEntry['extra'];
        if (
          isClassicAssetId(assetId) &&
          onChainRowForExtra?.limit !== undefined
        ) {
          extra = {
            limit: toDisplayBalance(onChainRowForExtra.limit, decimals),
            ...(onChainRowForExtra.authorized === undefined
              ? {}
              : { authorized: onChainRowForExtra.authorized }),
            ...(onChainRowForExtra.sponsored === undefined
              ? {}
              : { sponsored: onChainRowForExtra.sponsored }),
          };
        }

        result[assetId] = {
          metadata: assetMetadata,
          ...(extra === undefined ? {} : { extra }),
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
