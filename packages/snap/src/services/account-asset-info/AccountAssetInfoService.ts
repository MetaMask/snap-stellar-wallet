import {
  FungibleAssetMetadataStruct,
  type FungibleAssetMetadata,
} from '@metamask/snaps-sdk';
import { ensureError } from '@metamask/utils';

import type { AccountAssetInfoExtra } from './api';
import { GetAccountAssetInfoException } from './exceptions';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  isClassicAssetId,
  isSep41Id,
  toDisplayBalance,
} from '../../utils';
import type { AccountService } from '../account';
import type { AssetMetadataService } from '../asset-metadata/AssetMetadataService';
import type {
  OnChainAccount,
  OnChainAccountService,
} from '../on-chain-account';
import type { SpendableBalance } from '../on-chain-account/api';

export type AccountAssetInfoEntry = {
  metadata: FungibleAssetMetadata;
  extra?: AccountAssetInfoExtra;
};

export type GetAccountAssetInfoParams = {
  accountId: string;
  scope: KnownCaip2ChainId;
  assets: KnownCaip19AssetIdOrSlip44Id[];
};

export class AccountAssetInfoService {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #assetMetadataService: AssetMetadataService;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    assetMetadataService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    assetMetadataService: AssetMetadataService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[📦 AccountAssetInfoService]');
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
    this.#assetMetadataService = assetMetadataService;
  }

  /**
   * Returns fungible metadata and optional trust-line fields for the requested assets.
   * Classic Stellar assets include `extra.limit` when an on-chain row exists; omit `extra`
   * when the asset is not on the account (e.g. portfolio import pending trust line).
   *
   * @param params - Account id, scope, and CAIP-19 asset ids to resolve.
   * @returns Per-asset metadata and optional extra fields.
   */
  async getAccountAssetInfo(
    params: GetAccountAssetInfoParams,
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, AccountAssetInfoEntry>> {
    const { accountId, scope, assets } = params;
    const result = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      AccountAssetInfoEntry
    >;

    try {
      const onChainAccount = await this.#resolveOnChainAccount(
        accountId,
        scope,
      );

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
        const extra = buildAccountAssetInfoExtra(
          assetId,
          onChainRowForExtra,
          decimals,
        );

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

  async #resolveOnChainAccount(
    accountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount | null> {
    await this.#accountService.resolveAccount({ accountId });

    return this.#onChainAccountService.resolveOnChainAccountByKeyringAccountId(
      accountId,
      scope,
    );
  }
}

/**
 * Builds optional trust-line extra fields for classic Stellar assets.
 *
 * @param assetId - CAIP-19 asset id.
 * @param onChainRow - On-chain balance row, if any.
 * @param decimals - Asset display decimals.
 * @returns Trust-line extra fields, or undefined when not applicable.
 */
export function buildAccountAssetInfoExtra(
  assetId: KnownCaip19AssetIdOrSlip44Id,
  onChainRow: SpendableBalance | undefined,
  decimals: number,
): AccountAssetInfoExtra | undefined {
  if (!isClassicAssetId(assetId) || onChainRow === undefined) {
    return undefined;
  }
  if (onChainRow.limit === undefined) {
    return undefined;
  }

  return {
    limit: toDisplayBalance(onChainRow.limit, decimals),
    ...(onChainRow.authorized === undefined
      ? {}
      : { authorized: onChainRow.authorized }),
    ...(onChainRow.sponsored === undefined
      ? {}
      : { sponsored: onChainRow.sponsored }),
  };
}
