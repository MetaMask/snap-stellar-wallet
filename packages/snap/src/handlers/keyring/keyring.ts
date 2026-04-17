import {
  DiscoveredAccountType,
  KeyringEvent,
  type Balance,
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
import type { AssetMetadataService } from '../../services/asset-metadata';
import { getNativeAssetMetadata } from '../../services/asset-metadata/utils';
import { AccountNotActivatedException } from '../../services/network';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getSlip44AssetId,
  getSnapProvider,
  rethrowIfInstanceElseThrow,
  validateOrigin,
  validateRequest,
  withCatchAndThrowSnapError,
} from '../../utils';

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
    assetMetadataService,
    transactionService,
    handlers,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    assetMetadataService: AssetMetadataService;
    transactionService: TransactionService;
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
          await this.#emitCreatedAccountEvent(stellarKeyringAccount, options),
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
    try {
      const { account } = await this.#accountService.resolveAccount({
        accountId,
      });

      // We only support one scope in metamask today
      const onChainAccount =
        await this.#onChainAccountService.resolveOnChainAccount(
          account,
          AppConfig.selectedNetwork,
        );

      return onChainAccount.assetIds;
    } catch (error: unknown) {
      // fallback to single native asset if the account is not activated`
      if (error instanceof AccountNotActivatedException) {
        const slip44AssetId = getSlip44AssetId(AppConfig.selectedNetwork);
        return [slip44AssetId];
      }
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
    try {
      validateRequest(
        { accountId, pagination },
        ListAccountTransactionsRequestStruct,
      );

      const { limit, next } = pagination;

      // we dont necessary to check if the account is activated
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

      // Safeguard: If the next cursor is invalid, throw a RangeError.
      if (next !== undefined && next !== null && startIndex === -1) {
        throw new KeyringListAccountTransactionsException(
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

    // it is a never case because the struct validation ensures that the scopes length is 1
    if (scopes.length !== 1 || scopes[0] === undefined) {
      throw new Error('Invalid scope');
    }

    try {
      // Discover an account if it exists on the blockchain.
      const account = await this.#onChainAccountService.discoverOnChainAccount({
        entropySource,
        index: groupIndex,
        // we assume only one scope supported
        scope: scopes[0],
      });

      if (!account) {
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

    const nativeAssetMetadata = getNativeAssetMetadata(
      AppConfig.selectedNetwork,
    );

    const defaultAsset = {
      [nativeAssetMetadata.assetId]: {
        unit: nativeAssetMetadata.symbol,
        amount: '0',
      },
    } as Record<KnownCaip19AssetIdOrSlip44Id, Balance>;

    try {
      const { account } = await this.#accountService.resolveAccount({
        accountId,
      });

      const assetsMetadata =
        await this.#assetMetadataService.getAssetsMetadataByAssetIds(
          assets,
          AppConfig.selectedNetwork,
        );
      // We only support one scope in metamask today
      const onChainAccount =
        await this.#onChainAccountService.resolveOnChainAccount(
          account,
          AppConfig.selectedNetwork,
        );

      // onChainAccount.assetIds will always include the native asset
      return onChainAccount.assetIds.reduce((acc, assetId) => {
        const assetMetadata = assetsMetadata[assetId];
        // We dont filter by balance here because a asset is bind with trustline in Stellar Account.
        if (assetMetadata) {
          acc[assetId] = {
            unit: assetMetadata.symbol ?? '',
            amount: onChainAccount.getAsset(assetId).balance.toString(),
          };
        }
        return acc;
      }, defaultAsset);
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        // fallback to default asset if the account is not activated
        return defaultAsset;
      }
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
  ): Promise<ResolvedAccountAddress> {
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
        accountAddress: request.params.address,
      });
      return { address: `${scope}:${account.address}` };
    } catch (error: unknown) {
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
}
