import {
  AccountCreationType,
  assertCreateAccountOptionIsSupported,
  DiscoveredAccountType,
  KeyringEvent,
  type Balance,
  type CreateAccountOptions as KeyringApiCreateAccountOptions,
  type DiscoveredAccount,
  type EntropySourceId,
  type KeyringAccount,
  type KeyringRequest,
  type KeyringResponse,
  type Pagination,
  type ResolvedAccountAddress,
  type Transaction,
} from '@metamask/keyring-api';
import type {
  ExportAccountOptions,
  ExportedAccount,
  KeyringRpc,
} from '@metamask/keyring-api/v2';
import { PrivateKeyEncoding } from '@metamask/keyring-api/v2';
import {
  emitSnapKeyringEvent,
  MethodNotSupportedError,
} from '@metamask/keyring-snap-sdk';
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk/v2';
import {
  InvalidParamsError,
  type Json,
  type JsonRpcRequest,
} from '@metamask/snaps-sdk';
import { is } from '@metamask/superstruct';
import { type CaipAssetTypeOrId, HexStruct } from '@metamask/utils';

import type {
  CreateAccountOptions,
  GetAccountRequest,
  ResolveAccountAddressJsonRpcRequest,
  MultichainMethod,
} from './api';
import {
  Base58Struct,
  CreateAccountOptionsStruct,
  DeleteAccountRequestStruct,
  DiscoverAccountsStruct,
  ExportAccountHandlerRequestStruct,
  GetAccountRequestStruct,
  ListAccountTransactionsRequestStruct,
  MultichainMethodStruct,
  ResolveAccountAddressRequestStruct,
  SetSelectedAccountsRequestStruct,
  ListAccountAssetsRequestStruct,
  GetAccountBalancesRequestStruct,
} from './api';
import type { IKeyringRequestHandler } from './base';
import {
  KeyringAccountRollbackException,
  KeyringEmitAccountCreatedEventException,
  KeyringEmitAccountDeletedEventException,
} from './exceptions';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { AppConfig } from '../../config';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import { AccountNotFoundException } from '../../services/account/exceptions';
import type {
  OnChainAccount,
  OnChainAccountService,
} from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  Duration,
  getSlip44AssetId,
  getSnapProvider,
  isSlip44Id,
  toDisplayBalance,
  validateOrigin,
  validateRequest,
  withCatchAndThrowSnapError,
} from '../../utils';
import { RESOLVE_ACCOUNT_KEYRING_AND_WALLET } from '../accountResolver';
import type { AccountResolver } from '../accountResolver';
import { SyncAccountsHandler } from '../cronjob/syncAccounts';

export class KeyringHandler implements KeyringRpc {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #transactionService: TransactionService;

  readonly #accountResolver: AccountResolver;

  readonly #handlers: Record<MultichainMethod, IKeyringRequestHandler>;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    transactionService,
    accountResolver,
    handlers,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
    accountResolver: AccountResolver;
    handlers: Record<MultichainMethod, IKeyringRequestHandler>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
    this.#transactionService = transactionService;
    this.#accountResolver = accountResolver;
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
        return handleKeyringRequest(this, request);
      }, this.#logger)) ?? null;

    return result;
  }

  async listAccounts(): Promise<KeyringAccount[]> {
    const accounts = await this.#accountService.listAccounts();
    return accounts.map((account) => this.#toKeyringAccount(account));
  }

  async getAccount(accountId: GetAccountRequest): Promise<KeyringAccount> {
    validateRequest(accountId, GetAccountRequestStruct);
    const { account } = await this.#accountService.resolveAccount({
      accountId,
    });
    return this.#toKeyringAccount(account);
  }

  async getAccounts(): Promise<KeyringAccount[]> {
    return this.listAccounts();
  }

  /**
   * Exports the private key (raw ed25519 seed) for the specified account.
   *
   * @param accountId - ID of the account to export.
   * @param options - Optional export options (defaults to hexadecimal encoding).
   * @returns The exported private key data.
   */
  async exportAccount(
    accountId: string,
    options?: ExportAccountOptions,
  ): Promise<ExportedAccount> {
    validateRequest({ accountId, options }, ExportAccountHandlerRequestStruct);

    const { wallet } = await this.#accountResolver.resolveAccount({
      accountId,
      options: RESOLVE_ACCOUNT_KEYRING_AND_WALLET,
    });

    // `options.encoding` is the plain string-literal union from the v2 API
    // (`'hexadecimal' | 'base58'`), not the `PrivateKeyEncoding` enum type
    // `Wallet.exportKey` expects — even though the literal values match.
    const encoding =
      options?.encoding === PrivateKeyEncoding.Base58
        ? PrivateKeyEncoding.Base58
        : PrivateKeyEncoding.Hexadecimal;
    const privateKey = wallet.exportKey(encoding);

    // SECURITY: boolean `is` check only. An asserting validator's StructError
    // embeds the offending value — the private key — in its message, leaking it
    // to logs and the caller. On failure throw a value-free message.
    // Validate against the struct for the *requested* encoding specifically,
    // not either — a union would silently accept a mismatched encoding/value
    // pair (e.g. hex output returned for a base58 request).
    const encodingStruct =
      encoding === PrivateKeyEncoding.Base58 ? Base58Struct : HexStruct;
    if (!is(privateKey, encodingStruct)) {
      throw new Error('Derived private key failed encoding validation');
    }

    return { type: 'private-key', encoding, privateKey };
  }

  async createAccount(options?: CreateAccountOptions): Promise<KeyringAccount> {
    validateRequest(options, CreateAccountOptionsStruct);

    const { account, isNewAccount } =
      await this.#accountService.create(options);

    if (isNewAccount) {
      try {
        await this.#emitCreatedAccountEvent(account, options);
      } catch (error: unknown) {
        // Rollback if the event emission fails, e.g user rejected the account creation
        try {
          await this.#accountService.delete(account.id);
        } catch (deleteError: unknown) {
          // A more specific exception for the delete operation
          throw new KeyringAccountRollbackException(account.id, {
            cause: deleteError,
          });
        }

        throw new KeyringEmitAccountCreatedEventException({
          cause: error,
        });
      }
    }

    return this.#toKeyringAccount(account);
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
    ] as const);

    let accounts: KeyringAccount[] = [];

    if (options.type === AccountCreationType.Bip44DeriveIndex) {
      const { account } = await this.#accountService.create({
        entropySource: options.entropySource,
        index: options.groupIndex,
      });
      accounts.push(this.#toKeyringAccount(account));
    } else {
      const createdAccounts = await this.#accountService.batchCreate({
        entropySource: options.entropySource,
        fromIndex: options.range.from,
        toIndex: options.range.to,
      });
      accounts = createdAccounts.map((account) =>
        this.#toKeyringAccount(account),
      );
    }

    return accounts;
  }

  /**
   * Emits the account-created event to the wallet.
   * This triggers the wallet to prompt the user to add the account.
   * If the user accepts, the account is added; if the user rejects, an error is thrown.
   *
   * @param account - The account to emit the event for.
   * @param options - The options for the account creation.
   * @returns A Promise that resolves when the event is emitted.
   */
  async #emitCreatedAccountEvent(
    account: StellarKeyringAccount,
    options?: CreateAccountOptions,
  ): Promise<void> {
    const keyringAccount = this.#toKeyringAccount(account);
    await emitSnapKeyringEvent(getSnapProvider(), KeyringEvent.AccountCreated, {
      /**
       * We can't pass the `keyringAccount` object because it contains the index
       * and the Snaps SDK does not allow extra properties.
       */
      account: keyringAccount,
      /**
       * Skip account creation confirmation dialogs to make it look like a native
       * account creation flow.
       */
      displayConfirmation: false,
      /**
       * Internal options to MetaMask that include a correlation ID. We need
       * to also emit this ID to the Snap keyring.
       * Must be nested under `metamask` (keyring API). Do not spread
       * `options.metamask` onto params or `correlationId` ends up at
       * `params.correlationId` and fails validation (`never`).
       */
      ...(options?.metamask?.correlationId === undefined
        ? {}
        : { metamask: { correlationId: options.metamask.correlationId } }),
    });
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

  async listAccountAssets(accountId: string): Promise<CaipAssetTypeOrId[]> {
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

  async listAccountTransactions(
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

  async discoverAccounts(
    scopes: KnownCaip2ChainId[],
    entropySource: EntropySourceId,
    groupIndex: number,
  ): Promise<DiscoveredAccount[]> {
    validateRequest(
      { scopes, entropySource, groupIndex },
      DiscoverAccountsStruct,
    );

    const account = await this.#accountService.deriveKeyringAccount({
      entropySource,
      index: groupIndex,
    });

    const activityOnScopes = await Promise.all(
      scopes.map(async (scope) =>
        this.#onChainAccountService.isAccountActivated({
          accountAddress: account.address,
          scope,
        }),
      ),
    );

    const isActivated = activityOnScopes.some((active) => active);

    if (!isActivated) {
      return [];
    }

    return [
      {
        type: DiscoveredAccountType.Bip44,
        scopes,
        derivationPath: account.derivationPath,
      },
    ];
  }

  async getAccountBalances(
    accountId: string,
    assets: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, Balance>> {
    validateRequest({ accountId, assets }, GetAccountBalancesRequestStruct);

    const scope = AppConfig.selectedNetwork;
    const assetBalances = {} as Record<KnownCaip19AssetIdOrSlip44Id, Balance>;

    const { onChainAccount } = await this.#resolveAccountByAccountId(
      accountId,
      scope,
    );

    // If the account is not activated or not yet synced, return the native asset with zero balance
    if (onChainAccount === null) {
      const nativeAssetId = assets.find(isSlip44Id);
      if (nativeAssetId !== undefined) {
        assetBalances[nativeAssetId] = {
          unit: NATIVE_ASSET_SYMBOL,
          amount: '0',
        };
      }
      return assetBalances;
    }

    for (const assetId of assets) {
      const asset = onChainAccount.getAsset(assetId);
      // Skip when the asset is not visible (tombstone, zero SEP-41, or missing entry).
      if (asset === undefined) {
        continue;
      }

      if (isSlip44Id(assetId)) {
        // We show the raw native balance, not the spendable balance for XLM
        assetBalances[assetId] = {
          unit: NATIVE_ASSET_SYMBOL,
          amount: toDisplayBalance(onChainAccount.nativeRawBalance),
        };
      } else {
        assetBalances[assetId] = {
          unit: asset.symbol ?? '',
          amount: toDisplayBalance(asset.balance, asset.decimals),
        };
      }
    }
    return assetBalances;
  }

  async resolveAccountAddress(
    scope: KnownCaip2ChainId,
    request: ResolveAccountAddressJsonRpcRequest,
  ): Promise<ResolvedAccountAddress | null> {
    validateRequest(
      {
        request,
        scope,
      },
      ResolveAccountAddressRequestStruct,
    );

    try {
      const { account } = await this.#accountService.resolveAccount({
        scope,
        accountAddress: request.params.opts.address,
      });
      return { address: `${scope}:${account.address}` };
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

  async filterAccountChains(_id: string, _chains: string[]): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- MethodNotSupportedError is the keyring snap error surface
    throw new MethodNotSupportedError('filterAccountChains');
  }

  async updateAccount(_account: KeyringAccount): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- MethodNotSupportedError is the keyring snap error surface
    throw new MethodNotSupportedError('updateAccount');
  }

  async deleteAccount(accountId: string): Promise<void> {
    validateRequest(accountId, DeleteAccountRequestStruct);

    const { account } = await this.#accountService.resolveAccount({
      accountId,
    });

    try {
      // The delete event is idempotent, so it is safe to emit it even if the
      // account does not exist.
      // @see https://github.com/MetaMask/accounts/blob/main/packages/keyring-api/README.md?plain=1#L162
      await emitSnapKeyringEvent(
        getSnapProvider(),
        KeyringEvent.AccountDeleted,
        {
          id: account.id,
        },
      );
    } catch (error: unknown) {
      throw new KeyringEmitAccountDeletedEventException({
        cause: error,
      });
    }

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

  async submitRequest(request: KeyringRequest): Promise<KeyringResponse> {
    return { pending: false, result: await this.#handleSubmitRequest(request) };
  }

  async #handleSubmitRequest(request: KeyringRequest): Promise<Json> {
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
