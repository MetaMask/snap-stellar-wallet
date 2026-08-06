import type {
  CreateAccountOptions as KeyringApiCreateAccountOptions,
  KeyringAccount,
  KeyringRequest,
  Pagination,
  ResolvedAccountAddress,
  Transaction,
  Balance,
} from '@metamask/keyring-api';
import {
  AccountCreationType,
  assertCreateAccountOptionIsSupported,
} from '@metamask/keyring-api';
import type { KeyringSnapRpc } from '@metamask/keyring-api/v2';
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk/v2';
import { InvalidParamsError } from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import type {
  CaipAssetType,
  CaipAssetTypeOrId,
  CaipChainId,
} from '@metamask/utils';

import type { GetAccountRequest, MultichainMethod } from './api';
import {
  DeleteAccountRequestStruct,
  GetAccountRequestStruct,
  ListAccountTransactionsRequestStruct,
  MultichainMethodStruct,
  ResolveAccountAddressRequestStruct,
  SetSelectedAccountsRequestStruct,
  ListAccountAssetsRequestStruct,
  GetAccountBalancesRequestStruct,
} from './api';
import type { IKeyringRequestHandler } from './base';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { AppConfig } from '../../config';
import { SUPPORTED_SCOPES } from '../../constants';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import { AccountNotFoundException } from '../../services/account/exceptions';
import type {
  OnChainAccount,
  OnChainAccountService,
} from '../../services/on-chain-account';
import {
  toClassicBalanceEntry,
  getDefaultBalanceEntry,
  toNativeBalanceEntry,
  toStandardBalanceEntry,
} from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  Duration,
  getSlip44AssetId,
  isClassicAssetId,
  isSlip44Id,
  validateOrigin,
  validateRequest,
  withCatchAndThrowSnapError,
} from '../../utils';
import { SyncAccountsHandler } from '../cronjob/syncAccounts';

export class KeyringHandler implements KeyringSnapRpc {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #transactionService: TransactionService;

  readonly #handlers: Record<MultichainMethod, IKeyringRequestHandler>;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    transactionService,
    handlers,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
    handlers: Record<MultichainMethod, IKeyringRequestHandler>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
    this.#transactionService = transactionService;
    this.#handlers = handlers;
  }

  async handle(origin: string, request: JsonRpcRequest): Promise<Json> {
    const result =
      (await withCatchAndThrowSnapError(async () => {
        this.#logger.debug('Handle keyring request', {
          origin,
          method: request.method,
        });
        validateOrigin(origin, request.method);
        const keyringRequestResult = await handleKeyringRequest(this, request);
        this.#logger.debug('Keyring request handled', {
          origin,
          method: request.method,
          result: keyringRequestResult,
        });
        return keyringRequestResult;
      }, this.#logger)) ?? null;

    return result;
  }

  async getAccount(accountId: GetAccountRequest): Promise<KeyringAccount> {
    validateRequest(accountId, GetAccountRequestStruct);
    const account = await this.#accountService.findById(accountId);
    if (!account) {
      throw new AccountNotFoundException(accountId);
    }
    return this.#toKeyringAccount(account);
  }

  async getAccounts(): Promise<KeyringAccount[]> {
    const accounts = await this.#accountService.listAccounts();
    return accounts.map((account) => this.#toKeyringAccount(account));
  }

  /**
   * Batch account creation for the Snap keyring v2 path (no `AccountCreated` events).
   *
   * @param options - BIP-44 derive-index or derive-index-range options from the keyring API.
   * @returns Keyring accounts created or already present for each index.
   */
  async createAccounts(
    options: KeyringApiCreateAccountOptions,
  ): Promise<KeyringAccount[]> {
    assertCreateAccountOptionIsSupported(options, [
      `${AccountCreationType.Bip44DeriveIndex}`,
      `${AccountCreationType.Bip44DeriveIndexRange}`,
      `${AccountCreationType.Bip44Discover}`,
    ] as const);

    // For discovery, only create the account if it has on-chain activity. No
    // activity means we've reached the end of the discoverable accounts, so we
    // return nothing and the client stops discovering.
    if (options.type === AccountCreationType.Bip44Discover) {
      const account = await this.#accountService.deriveKeyringAccount({
        entropySource: options.entropySource,
        index: options.groupIndex,
      });

      if (!(await this.#hasOnChainActivity(account, SUPPORTED_SCOPES))) {
        return [];
      }
    }

    let range;
    if (options.type === AccountCreationType.Bip44DeriveIndexRange) {
      range = options.range;
    } else {
      // Bip44DeriveIndex | Bip44Discover — a single group index. Ranges are
      // inclusive, so `from` and `to` are the same.
      range = { from: options.groupIndex, to: options.groupIndex };
    }

    const createdAccounts = await this.#accountService.batchCreate({
      entropySource: options.entropySource,
      fromIndex: range.from,
      toIndex: range.to,
    });

    return createdAccounts.map((account) => this.#toKeyringAccount(account));
  }

  #toKeyringAccount(account: StellarKeyringAccount): KeyringAccount {
    const { id, address, type, options, methods, scopes } = account;
    return {
      id,
      address,
      type,
      options,
      methods,
      scopes,
    };
  }

  async getAccountAssets(accountId: string): Promise<CaipAssetTypeOrId[]> {
    validateRequest(accountId, ListAccountAssetsRequestStruct);

    const scope = AppConfig.selectedNetwork;

    const { onChainAccount } = await this.#resolveAccountByAccountId(
      accountId,
      scope,
    );

    // If the account is not activated or not yet synced, return the native asset with zero balance
    if (onChainAccount === null) {
      return [getSlip44AssetId(scope)];
    }

    // Visible assets only (see {@link OnChainAccount.assetIds}).
    return onChainAccount.assetIds;
  }

  async getAccountTransactions(
    accountId: string,
    pagination: Pagination,
  ): Promise<{
    data: Transaction[];
    next: string | null;
  }> {
    validateRequest(
      { accountId, pagination },
      ListAccountTransactionsRequestStruct,
    );

    const { limit, next } = pagination;

    // It is not necessary to check if the account is activated
    // because we are not fetching the transactions from the network.
    const { account: keyringAccount } =
      await this.#accountService.resolveAccount({
        accountId,
      });

    const transactions = await this.#transactionService.findByAccountId(
      keyringAccount.id,
    );

    // Find the starting index based on the 'next' signature
    const startIndex = next
      ? transactions.findIndex((tx) => tx.id === next)
      : 0;

    // Safeguard: If the next cursor is invalid, throw the account-based exception
    // with the correct account identifier.
    if (next !== undefined && next !== null && startIndex === -1) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- InvalidParamsError is the JSON-RPC snap error surface
      throw new InvalidParamsError(
        `Invalid transaction pagination cursor ${next}`,
      );
    }

    // Get transactions from startIndex to startIndex + limit
    const accountTransactions = transactions.slice(
      startIndex,
      startIndex + limit,
    );

    // Determine the next signature for pagination
    const hasMore = startIndex + pagination.limit < transactions.length;
    const nextSignature = hasMore
      ? (transactions[startIndex + pagination.limit]?.id ?? null)
      : null;

    return {
      data: accountTransactions,
      next: nextSignature,
    };
  }

  /**
   * Checks whether the given account is activated on any of the given scopes.
   *
   * @param account - The derived account to check.
   * @param scopes - The scopes to check for on-chain activity.
   * @returns Whether the account is activated on at least one scope.
   */
  async #hasOnChainActivity(
    account: StellarKeyringAccount,
    scopes: KnownCaip2ChainId[],
  ): Promise<boolean> {
    const activityOnScopes = await Promise.all(
      scopes.map(async (scope) =>
        this.#onChainAccountService.isAccountActivated({
          accountAddress: account.address,
          scope,
        }),
      ),
    );

    return activityOnScopes.some((active) => active);
  }

  async getAccountBalances(
    accountId: string,
    assets: CaipAssetType[],
  ): Promise<Record<CaipAssetType, Balance>> {
    const { assets: knownAssets } = validateRequest(
      { accountId, assets },
      GetAccountBalancesRequestStruct,
    );

    const scope = AppConfig.selectedNetwork;
    const assetBalances = {} as Record<KnownCaip19AssetIdOrSlip44Id, Balance>;

    const { onChainAccount } = await this.#resolveAccountByAccountId(
      accountId,
      scope,
    );

    // If the account is not activated or not yet synced, return the native asset with zero balance
    if (onChainAccount === null) {
      const nativeAssetId = knownAssets.find(isSlip44Id);
      if (nativeAssetId !== undefined) {
        assetBalances[nativeAssetId] = getDefaultBalanceEntry();
      }
      return assetBalances;
    }

    for (const assetId of knownAssets) {
      const asset = onChainAccount.getAsset(assetId);
      // Skip when the asset is not visible (tombstone, zero SEP-41, or missing entry).
      if (asset === undefined) {
        continue;
      }

      if (isSlip44Id(assetId)) {
        assetBalances[assetId] = toNativeBalanceEntry({
          nativeBalance: onChainAccount.nativeRawBalance,
          spendableBalance: onChainAccount.nativeSpendableBalance,
          minimumReserveBalance: onChainAccount.minimumReserveBalance,
        });
      } else if (isClassicAssetId(assetId)) {
        assetBalances[assetId] = toClassicBalanceEntry(asset);
      } else {
        assetBalances[assetId] = toStandardBalanceEntry(asset);
      }
    }
    return assetBalances;
  }

  async resolveAccountAddress(
    scope: CaipChainId,
    request: JsonRpcRequest,
  ): Promise<ResolvedAccountAddress | null> {
    const { scope: knownScope, request: sep43Request } = validateRequest(
      {
        request,
        scope,
      },
      ResolveAccountAddressRequestStruct,
    );

    try {
      const { account } = await this.#accountService.resolveAccount({
        scope: knownScope,
        accountAddress: sep43Request.params.opts.address,
      });
      return { address: `${knownScope}:${account.address}` };
    } catch (error: unknown) {
      // Return `null` signals "this snap does not
      // own the requested address" so MetaMask's routing layer will fallback to
      // the current connected account.
      if (error instanceof AccountNotFoundException) {
        return null;
      }

      throw error;
    }
  }

  async deleteAccount(accountId: string): Promise<void> {
    validateRequest(accountId, DeleteAccountRequestStruct);

    await this.#accountService.delete(accountId);
  }

  async setSelectedAccounts(accountIds: string[]): Promise<void> {
    validateRequest(accountIds, SetSelectedAccountsRequestStruct);
    const uniqueAccountIdsSet = new Set(accountIds);
    const deduplicatedAccountIds = Array.from(uniqueAccountIdsSet);

    const accounts = await this.#accountService.findByIds(
      deduplicatedAccountIds,
    );

    if (accounts.length !== deduplicatedAccountIds.length) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- InvalidParamsError is the JSON-RPC snap error surface
      throw new InvalidParamsError(
        'Account IDs were not part of existing accounts.',
      );
    }

    if (deduplicatedAccountIds.length > 0) {
      await SyncAccountsHandler.scheduleBackgroundEvent(
        {
          accountIds: deduplicatedAccountIds,
        },
        // Start immediately
        Duration.OneSecond,
      );
    }
  }

  async submitRequest(request: KeyringRequest): Promise<Json> {
    const { method } = request.request;

    this.#assertMethodIsValid(method);

    return this.#handlers[method].handle(request);
  }

  #assertMethodIsValid(method: string): asserts method is MultichainMethod {
    validateRequest(method, MultichainMethodStruct);
  }

  async #resolveAccountByAccountId(
    accountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<{
    account: StellarKeyringAccount;
    onChainAccount: OnChainAccount | null;
  }> {
    const { account } = await this.#accountService.resolveAccount({
      accountId,
    });

    // We read the on-chain account from state, which is synced in the background.
    // This improves performance compared to fetching account data from the network on every request.
    // The trade-off is that the data can be slightly stale within the sync window.
    const onChainAccount =
      await this.#onChainAccountService.resolveOnChainAccountByKeyringAccountId(
        accountId,
        scope,
      );

    return { account, onChainAccount };
  }
}
