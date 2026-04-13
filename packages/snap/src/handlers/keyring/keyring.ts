/* eslint-disable @typescript-eslint/no-unused-vars */
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
import {
  ensureError,
  type CaipAssetType,
  type CaipAssetTypeOrId,
} from '@metamask/utils';

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
  MultichainMethodStruct,
  ResolveAccountAddressRequestStruct,
  SetSelectedAccountsRequestStruct,
} from './api';
import type { KnownCaip2ChainId } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getSnapProvider,
  validateOrigin,
  validateRequest,
  withCatchAndThrowSnapError,
} from '../../utils';

export class KeyringHandler implements Keyring {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  constructor({
    logger,
    accountService,
    onChainAccountService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
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
      throw new Error(`Error listing accounts: ${ensureError(error).message}`);
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
      throw new Error(`Error getting account: ${ensureError(error).message}`);
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
      throw new Error(`Error creating account: ${ensureError(error).message}`);
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
       */
      ...(options?.metamask ?? {}),
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
    throw new Error('Method not implemented. - listAccountAssets');
  }

  async listAccountTransactions(
    accountId: string,
    pagination: Pagination,
  ): Promise<{
    data: Transaction[];
    next: string | null;
  }> {
    throw new Error('Method not implemented. - listAccountTransactions');
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
      throw new Error(
        `Error discovering accounts: ${ensureError(error).message}`,
      );
    }
  }

  async getAccountBalances(
    accountId: string,
    assets: CaipAssetType[],
  ): Promise<Record<CaipAssetType, Balance>> {
    throw new Error('Method not implemented. - getAccountBalances');
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
      throw new Error(
        `Error resolving account address: ${ensureError(error).message}`,
      );
    }
  }

  async filterAccountChains(id: string, chains: string[]): Promise<string[]> {
    throw new Error('Method not implemented. - filterAccountChains');
  }

  async updateAccount(account: KeyringAccount): Promise<void> {
    throw new Error('Method not implemented. - updateAccount');
  }

  async deleteAccount(accountId: string): Promise<void> {
    validateRequest(accountId, DeleteAccountRequestStruct);

    try {
      const { account } = await this.#accountService.resolveAccount({
        accountId,
      });

      await emitSnapKeyringEvent(
        getSnapProvider(),
        KeyringEvent.AccountDeleted,
        {
          id: account.id,
        },
      );

      await this.#accountService.delete(accountId);
    } catch (error: unknown) {
      throw new Error(`Error deleting account: ${ensureError(error).message}`);
    }
  }

  async setSelectedAccounts(accountIds: string[]): Promise<void> {
    validateRequest(accountIds, SetSelectedAccountsRequestStruct);
    // TODO: Implement the setSelectedAccounts method.
  }

  async submitRequest(request: KeyringRequest): Promise<KeyringResponse> {
    return { pending: false, result: await this.#handleSubmitRequest(request) };
  }

  async #handleSubmitRequest(request: KeyringRequest): Promise<Json> {
    throw new Error('Method not implemented. - handleSubmitRequest');
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
