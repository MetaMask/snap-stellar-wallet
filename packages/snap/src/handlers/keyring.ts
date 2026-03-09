/* eslint-disable @typescript-eslint/no-unused-vars */
import {
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
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import type { Infer } from '@metamask/superstruct';
import {
  assert,
  object,
  min,
  optional,
  string,
  integer,
} from '@metamask/superstruct';
import {
  ensureError,
  type CaipAssetType,
  type CaipAssetTypeOrId,
  type CaipChainId,
} from '@metamask/utils';

import type {
  AccountService,
  StellarKeyringAccount,
} from '../services/account';
import {
  createPrefixedLogger,
  getSnapProvider,
  type ILogger,
  validateOrigin,
  withCatchAndThrowSnapError,
} from '../utils';

/**
 * The struct for validating createAccount options.
 * - entropySource: Optional string for the entropy source
 * - index: Optional non-negative integer for account derivation index
 */
export const CreateAccountOptionsStruct = optional(
  object({
    entropySource: optional(string()),
    index: optional(min(integer(), 0)),
    addressType: optional(string()),
    scope: optional(string()),
    metamask: optional(
      object({
        correlationId: optional(string()),
      }),
    ),
  }),
);

/**
 * The options for the createAccount method.
 */
export type CreateAccountOptions = Infer<typeof CreateAccountOptionsStruct>;

export class KeyringHandler implements Keyring {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  constructor({
    logger,
    accountService,
  }: {
    logger: ILogger;
    accountService: AccountService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
    this.#accountService = accountService;
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
    throw new Error('Method not implemented.');
  }

  async getAccount(accountId: string): Promise<KeyringAccount | undefined> {
    throw new Error('Method not implemented.');
  }

  async createAccount(options?: CreateAccountOptions): Promise<KeyringAccount> {
    try {
      assert(options, CreateAccountOptionsStruct);

      const account = await this.#accountService.create(
        options,
        async (stellarKeyringAccount: StellarKeyringAccount) =>
          await this.#emitCreatedAccountEvent(stellarKeyringAccount, options),
      );

      return this.#toKeyringAccount(account);
    } catch (error: unknown) {
      this.#logger.error({ error }, 'Error creating account');
      throw new Error(`Error creating account: ${ensureError(error).message}`);
    }
  }

  /**
   * Emits the account created event to wallet.
   * This will trigger the wallet to prompt the user to add the account to the wallet
   * if the user accepts, the account will be added to the wallet
   * if the user rejects, it will throw an error
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
       * and the snaps sdk does not allow extra properties.
       */
      account: keyringAccount,
      /**
       * Skip account creation confirmation dialogs to make it look like a native
       * account creation flow.
       */
      displayConfirmation: false,
      /**
       * Internal options to MetaMask that includes a correlation ID. We need
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
    throw new Error('Method not implemented.');
  }

  async listAccountTransactions(
    accountId: string,
    pagination: Pagination,
  ): Promise<{
    data: Transaction[];
    next: string | null;
  }> {
    throw new Error('Method not implemented.');
  }

  async discoverAccounts(
    scopes: CaipChainId[],
    entropySource: EntropySourceId,
    groupIndex: number,
  ): Promise<DiscoveredAccount[]> {
    throw new Error('Method not implemented.');
  }

  async getAccountBalances(
    accountId: string,
    assets: CaipAssetType[],
  ): Promise<Record<CaipAssetType, Balance>> {
    throw new Error('Method not implemented.');
  }

  async resolveAccountAddress(
    scope: CaipChainId,
    request: JsonRpcRequest,
  ): Promise<ResolvedAccountAddress> {
    throw new Error('Method not implemented.');
  }

  async filterAccountChains(id: string, chains: string[]): Promise<string[]> {
    throw new Error('Method not implemented.');
  }

  async updateAccount(account: KeyringAccount): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async deleteAccount(accountId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async submitRequest(request: KeyringRequest): Promise<KeyringResponse> {
    return { pending: false, result: await this.#handleSubmitRequest(request) };
  }

  async #handleSubmitRequest(request: KeyringRequest): Promise<Json> {
    throw new Error('Method not implemented.');
  }

  async setSelectedAccounts(accountIds: string[]): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
