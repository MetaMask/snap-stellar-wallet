/* eslint-disable @typescript-eslint/no-unused-vars */
import {
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
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import type {
  CaipAssetType,
  CaipAssetTypeOrId,
  CaipChainId,
} from '@metamask/utils';

import { createPrefixedLogger, type ILogger, validateOrigin } from '../utils';

export class KeyringHandler implements Keyring {
  // eslint-disable-next-line no-unused-private-class-members
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 KeyringHandler]');
  }

  async handle(origin: string, request: JsonRpcRequest): Promise<Json> {
    validateOrigin(origin, request.method);

    const result = (await handleKeyringRequest(this, request)) ?? null;

    return result;
  }

  async listAccounts(): Promise<KeyringAccount[]> {
    throw new Error('Method not implemented.');
  }

  async getAccount(accountId: string): Promise<KeyringAccount | undefined> {
    throw new Error('Method not implemented.');
  }

  async createAccount(options?: unknown): Promise<KeyringAccount> {
    throw new Error('Method not implemented.');
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
