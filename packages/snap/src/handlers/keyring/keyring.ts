import {
  AccountCreationType,
  assertCreateAccountOptionIsSupported,
  DiscoveredAccountType,
  KeyringEvent,
  type Balance,
  type CreateAccountOptions as KeyringApiCreateAccountOptions,
  type DiscoveredAccount,
  type EntropySourceId,
  type Keyring,
  type KeyringAccount,
  type KeyringRequest,
  type KeyringResponse,
  type Pagination,
  type ResolvedAccountAddress,
  type Transaction,
} from '@metamask/keyring-api';
import {
  emitSnapKeyringEvent,
  handleKeyringRequest,
} from '@metamask/keyring-snap-sdk';
import { type Json, type JsonRpcRequest } from '@metamask/snaps-sdk';
import { FungibleAssetMetadataStruct } from '@metamask/snaps-sdk';
import { ensureError, type CaipAssetTypeOrId } from '@metamask/utils';

import type {
  CreateAccountOptions,
  GetAccountRequest,
  ResolveAccountAddressJsonRpcRequest,
  MultichainMethod,
} from './api';
import {
  CreateAccountOptionsStruct,
  DeleteAccountRequestStruct,
  DiscoverAccountsStruct,
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
  KeyringCreateAccountException,
  KeyringDeleteAccountException,
  KeyringDiscoverAccountsException,
  KeyringEmitAccountCreatedEventException,
  KeyringGetAccountBalancesException,
  KeyringGetAccountException,
  KeyringListAccountAssetsException,
  KeyringListAccountsException,
  KeyringListAccountTransactionsException,
  KeyringResolveAccountAddressException,
} from './exceptions';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { AppConfig } from '../../config';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import { AccountNotFoundException } from '../../services/account/exceptions';
import type { AssetMetadataService } from '../../services/asset-metadata';
import { getNativeAssetMetadata } from '../../services/asset-metadata/utils';
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
  isSep41Id,
  isSlip44Id,
  toDisplayBalance,
  rethrowIfInstanceElseThrow,
  validateOrigin,
  validateRequest,
  withCatchAndThrowSnapError,
} from '../../utils';
import { SyncAccountsHandler } from '../cronjob/syncAccounts';

export class KeyringHandler implements Keyring {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #handlers: Record<MultichainMethod, IKeyringRequestHandler>;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    transactionService,
    assetMetadataService,
    handlers,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
    assetMetadataService: AssetMetadataService;
    handlers: Record<MultichainMethod, IKeyringRequestHandler>;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
    this.#transactionService = transactionService;
    this.#assetMetadataService = assetMetadataService;
    this.#handlers = handlers;
  }

  async handle(origin: string, request: JsonRpcRequest): Promise<Json> {
    const result =
      (await withCatchAndThrowSnapError(async () => {
        validateOrigin(origin, request.method);
        return handleKeyringRequest(this, request);
      }, this.#logger)) ?? null;

    return result;
  }

  async listAccounts(): Promise<KeyringAccount[]> {
    try {
      const accounts = await this.#accountService.listAccounts();
      return accounts.map((account) => this.#toKeyringAccount(account));
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to list accounts',
        ensureError(error).message,
      );
      throw new KeyringListAccountsException();
    }
  }

  async getAccount(
    accountId: GetAccountRequest,
  ): Promise<KeyringAccount | undefined> {
    validateRequest(accountId, GetAccountRequestStruct);

    try {
      const account = await this.#accountService.findById(accountId);
      return account ? this.#toKeyringAccount(account) : undefined;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to get account',
        ensureError(error).message,
      );
      throw new KeyringGetAccountException(accountId);
    }
  }

  async createAccount(options?: CreateAccountOptions): Promise<KeyringAccount> {
    validateRequest(options, CreateAccountOptionsStruct);

    try {
      const account = await this.#accountService.create(
        options,
        async (stellarKeyringAccount: StellarKeyringAccount) =>
          this.#emitCreatedAccountEvent(stellarKeyringAccount, options),
      );

      return this.#toKeyringAccount(account);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to create account',
        ensureError(error).message,
      );
      throw new KeyringCreateAccountException();
    }
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

    try {
      const accounts: KeyringAccount[] = [];

      if (options.type === AccountCreationType.Bip44DeriveIndex) {
        const account = await this.#accountService.create({
          entropySource: options.entropySource,
          index: options.groupIndex,
        });
        accounts.push(this.#toKeyringAccount(account));
      } else {
        for (
          let groupIndex = options.range.from;
          groupIndex <= options.range.to;
          groupIndex += 1
        ) {
          const account = await this.#accountService.create({
            entropySource: options.entropySource,
            index: groupIndex,
          });
          accounts.push(this.#toKeyringAccount(account));
        }
      }

      return accounts;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to create accounts',
        ensureError(error).message,
      );
      throw new KeyringCreateAccountException();
    }
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

    try {
      await emitSnapKeyringEvent(
        getSnapProvider(),
        KeyringEvent.AccountCreated,
        {
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
        },
      );
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to emit account created event',
        error,
      );
      throw new KeyringEmitAccountCreatedEventException();
    }
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

    try {
      const { onChainAccount } = await this.#resolveAccountByAccountId(
        accountId,
        scope,
      );

      // If the account is not activated or not yet synced, return the native asset with zero balance
      if (onChainAccount === null) {
        return [getSlip44AssetId(scope)];
      }

      // Non-SEP-41 (native + classic): always list. SEP-41: only if row exists and balance > 0.
      return onChainAccount.assetIds.filter((assetId) => {
        return (
          !isSep41Id(assetId) || onChainAccount.getAsset(assetId)?.balance.gt(0)
        );
      });
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to list account assets',
        ensureError(error).message,
      );
      throw new KeyringListAccountAssetsException(accountId);
    }
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

    try {
      const { limit, next } = pagination;

      // It is not necessary to check if the account is activated
      // because we are not fetching the transactions from the network.
      const { account: keyringAccount } =
        await this.#accountService.resolveAccount({
          accountId,
        });

      const transactions = await this.#transactionService.findByAccounts([
        keyringAccount,
      ]);

      // Find the starting index based on the 'next' signature
      const startIndex = next
        ? transactions.findIndex((tx) => tx.id === next)
        : 0;

      // Safeguard: If the next cursor is invalid, throw the account-based exception
      // with the correct account identifier.
      if (next !== undefined && next !== null && startIndex === -1) {
        throw new KeyringListAccountTransactionsException(
          accountId,
          `Invalid transaction pagination cursor: ${next}`,
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
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to list account transactions',
        ensureError(error).message,
      );
      return rethrowIfInstanceElseThrow(
        error,
        [KeyringListAccountTransactionsException],
        new KeyringListAccountTransactionsException(accountId),
      );
    }
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

    // DiscoverAccountsStruct enforces exactly one scope; this guards TypeScript.
    const scope = scopes[0];
    if (scope === undefined) {
      throw new Error('Invariant: discoverAccounts requires one scope');
    }

    try {
      const account = await this.#accountService.deriveKeyringAccount({
        entropySource,
        index: groupIndex,
      });
      // Discover an account if it exists on the blockchain.
      const isActivated = await this.#onChainAccountService.isAccountActivated({
        accountAddress: account.address,
        scope,
      });

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
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to discover accounts',
        ensureError(error).message,
      );
      throw new KeyringDiscoverAccountsException();
    }
  }

  async getAccountBalances(
    accountId: string,
    assets: KnownCaip19AssetIdOrSlip44Id[],
  ): Promise<Record<KnownCaip19AssetIdOrSlip44Id, Balance>> {
    validateRequest({ accountId, assets }, GetAccountBalancesRequestStruct);

    const scope = AppConfig.selectedNetwork;
    const assetBalances = {} as Record<KnownCaip19AssetIdOrSlip44Id, Balance>;

    try {
      const { onChainAccount } = await this.#resolveAccountByAccountId(
        accountId,
        scope,
      );

      // If the account is not activated or not yet synced, return the native asset with zero balance
      if (onChainAccount === null) {
        const nativeAssetId = assets.find(isSlip44Id);
        if (nativeAssetId !== undefined) {
          assetBalances[nativeAssetId] = {
            unit: getNativeAssetMetadata(scope).symbol ?? '',
            amount: '0',
          };
        }
        return assetBalances;
      }

      const assetsMetadata =
        await this.#assetMetadataService.getAssetsMetadataByAssetIds(assets);

      for (const assetId of assets) {
        const asset = onChainAccount.getAsset(assetId);
        const assetMetadata = assetsMetadata[assetId];
        // We support get balacne for a asset when:
        // - Asset is found from the on-chain account
        // - Asset metadata is found
        // - Asset metadata is a fungible asset
        // - Asset is Native / classic trustlines: always include.
        // - Asset is SEP-41: only include if balance is greater than zero.
        if (
          asset === undefined ||
          assetMetadata === undefined ||
          assetMetadata === null ||
          !FungibleAssetMetadataStruct.is(assetMetadata) ||
          assetMetadata.units[0]?.decimals === undefined ||
          (isSep41Id(assetId) && !asset.balance.gt(0))
        ) {
          continue;
        }

        const decimal = assetMetadata.units[0].decimals;
        assetBalances[assetId] = {
          unit: asset.symbol ?? '',
          amount: toDisplayBalance(asset.balance, decimal),
        };
      }
      return assetBalances;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to get account balances',
        ensureError(error).message,
      );
      throw new KeyringGetAccountBalancesException(accountId);
    }
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
      // Per the keyring API, returning `null` signals "this snap does not
      // own the requested address" so MetaMask's routing layer will fallback to
      // the current connected account.
      if (error instanceof AccountNotFoundException) {
        return null;
      }
      this.#logger.logErrorWithDetails(
        'Failed to resolve account address',
        ensureError(error).message,
      );
      throw new KeyringResolveAccountAddressException(scope, request);
    }
  }

  async filterAccountChains(_id: string, _chains: string[]): Promise<string[]> {
    throw new Error('Method not implemented. - filterAccountChains');
  }

  async updateAccount(_account: KeyringAccount): Promise<void> {
    throw new Error('Method not implemented. - updateAccount');
  }

  async deleteAccount(accountId: string): Promise<void> {
    validateRequest(accountId, DeleteAccountRequestStruct);

    try {
      const { account } = await this.#accountService.resolveAccount({
        accountId,
      });

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

      await this.#accountService.delete(accountId);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to delete account',
        ensureError(error).message,
      );
      throw new KeyringDeleteAccountException(accountId);
    }
  }

  async setSelectedAccounts(accountIds: string[]): Promise<void> {
    validateRequest(accountIds, SetSelectedAccountsRequestStruct);

    await SyncAccountsHandler.scheduleBackgroundEvent(
      {
        accountIds,
      },
      // Start immediately
      Duration.OneSecond,
    );
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
