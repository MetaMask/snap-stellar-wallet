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

export class GetAccountAssetInfoHandler extends BaseClientRequestHandler<
  GetAccountAssetInfoJsonRpcRequest,
  GetAccountAssetInfoJsonRpcResponse
> {
  readonly #logger: ILogger;

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
    return this.#buildAccountAssetInfoResponse(resolved.onChainAccount, assets);
  }

  /**
   * Returns empty trust-line entries when the account is not activated.
   * Tolerates unactivated accounts for portfolio-import UX instead of showing the activation prompt.
   *
   * @param _error - The account not activated error.
   * @param request - The JSON-RPC request with assets to describe.
   * @returns Per-asset trust-line fields without on-chain data.
   */
  protected override async handleAccountNotActivatedError(
    _error: AccountNotActivatedException,
    request: GetAccountAssetInfoJsonRpcRequest,
  ): Promise<GetAccountAssetInfoJsonRpcResponse> {
    const { assets } = request.params;
    return this.#buildEmptyTrustLineEntries(assets);
  }

  #buildEmptyTrustLineEntries(
    assets: KnownCaip19AssetIdOrSlip44Id[],
  ): Record<KnownCaip19AssetIdOrSlip44Id, AccountAssetInfoExtra> {
    const result = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AccountAssetInfoExtra
    >;

    for (const assetId of assets) {
      if (!isClassicAssetId(assetId)) {
        continue;
      }
      result[assetId] = {};
    }

    return result;
  }

  #buildAccountAssetInfoResponse(
    onChainAccount: OnChainAccount,
    assets: KnownCaip19AssetIdOrSlip44Id[],
  ): Record<KnownCaip19AssetIdOrSlip44Id, AccountAssetInfoExtra> {
    const result = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AccountAssetInfoExtra
    >;

    for (const assetId of assets) {
      if (!isClassicAssetId(assetId)) {
        continue;
      }

      // Use getRawAsset (not getAsset): trust-line UX needs tombstones and
      // zero-limit rows that getAsset filters out for spendable-balance flows.
      const assetData = onChainAccount.getRawAsset(assetId);

      if (assetData?.limit === undefined) {
        // TODO: re-fetch from horizon when classic asset row is missing or has no limit.
        this.#logger.logErrorWithDetails(
          'Data error: classic asset missing trust-line limit in on-chain snapshot',
          {
            assetId,
            reason:
              assetData === undefined
                ? 'No stored row for this classic asset id (not synced or never trusted)'
                : 'Stored row exists but limit field is undefined',
            remark:
              'Returning empty trust-line entry; portfolio may treat asset as untrusted',
          },
        );
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
  }
}
