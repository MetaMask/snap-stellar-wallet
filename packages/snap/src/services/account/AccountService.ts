import type { EntropySourceId } from '@metamask/keyring-api';
import { ensureError } from '@metamask/utils';

import type { AccountsRepository } from './AccountsRepository';
import type { StellarKeyringAccount, StellarDerivationPath } from './api';
import {
  AccountNotFoundException,
  AccountRollbackException,
  AccountServiceException,
} from './exceptions';
import { assertSameAddress } from './utils';
import type { StellarAddress, KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { KEYRING_ACCOUNT_TYPE } from '../../constants';
import { MultichainMethod } from '../../handlers/keyring';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getDefaultEntropySource,
  getLowestIndex,
} from '../../utils';
import { getDerivationPath, type WalletService } from '../wallet';

/**
 * Manages Stellar keyring accounts: creation, resolution from state, derivation checks, and persistence.
 */
export class AccountService {
  readonly #logger: ILogger;

  readonly #walletService: WalletService;

  readonly #accountsRepository: AccountsRepository;

  constructor({
    logger,
    accountsRepository,
    walletService,
  }: {
    logger: ILogger;
    accountsRepository: AccountsRepository;
    walletService: WalletService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 AccountService]');
    this.#walletService = walletService;
    this.#accountsRepository = accountsRepository;
  }

  /**
   * Builds a keyring-shaped account from entropy and index without reading or writing keyring state.
   *
   * @param options - Derivation inputs.
   * @param options.entropySource - Entropy source ID (e.g. from the keyring).
   * @param options.index - BIP-44 account index.
   * @returns A promise that resolves to the derived {@link StellarKeyringAccount} shape (new random id).
   */
  async deriveKeyringAccount({
    entropySource,
    index,
  }: {
    entropySource: EntropySourceId;
    index: number;
  }): Promise<StellarKeyringAccount> {
    return await this.#deriveAccount({ entropySource, index });
  }

  /**
   * Resolves a keyring account from state by ID or address and verifies the stored address matches derivation.
   *
   * @param params - The parameters for the account resolution.
   * @param params.scope - Required when resolving by address.
   * @param params.accountId - The ID of the account to resolve.
   * @param params.accountAddress - The address of the account to resolve.
   * @returns A promise that resolves to the keyring account from state.
   * @throws {AccountNotFoundException} When no account matches the given id or address/scope.
   * @throws {AccountServiceException} When `accountAddress` is set without `scope`, or neither id nor address is set.
   * @throws {DerivedAccountAddressMismatchException} When the stored address does not match re-derivation.
   */
  async resolveAccount({
    scope,
    accountId,
    accountAddress,
  }: {
    scope?: KnownCaip2ChainId;
    accountId?: string;
    accountAddress?: StellarAddress;
  }): Promise<{ account: StellarKeyringAccount }> {
    let account: StellarKeyringAccount;

    if (accountId) {
      account = await this.#resolveKeyringAccountById(accountId);
    } else if (accountAddress) {
      if (!scope) {
        throw new AccountServiceException(
          'Scope is required when resolving by address',
        );
      }
      account = await this.#resolveKeyringAccountByAddress({
        scope,
        address: accountAddress,
      });
    } else {
      throw new AccountServiceException(
        'Either accountId or accountAddress is required',
      );
    }

    const { entropySource, index, address } = account;

    const derivedAddress = await this.#walletService.deriveAddress({
      entropySource,
      index,
    });

    assertSameAddress(address, derivedAddress);

    return { account };
  }

  /**
   * Creates a Stellar account with the given options.
   *
   * @param options - The options for account creation.
   * @param options.entropySource - The entropy source to use for derivation.
   * @param options.index - The derivation index to use (defaults to the lowest unused index).
   * @param callback - Optional callback invoked after the account is created; if it throws, the account is removed.
   * @returns A Promise that resolves to the created account. If an account with the same derivation path and entropy source already exists, it is returned instead.
   */
  async create(
    options?: {
      entropySource?: EntropySourceId;
      index?: number;
    },
    callback?: (account: StellarKeyringAccount) => Promise<void>,
  ): Promise<StellarKeyringAccount> {
    const accounts = await this.#accountsRepository.getAll();

    const entropySource =
      options?.entropySource ?? (await getDefaultEntropySource());

    const derivationIndex =
      options?.index ??
      this.#getLowestUnusedIndex({
        entropySource,
        accounts,
      });

    /**
     * Now that we have the `entropySource` and `index` ready,
     * we need to make sure that they do not correspond to an existing account already.
     */
    const sameAccount = accounts.find(
      (account) =>
        account.index === derivationIndex &&
        account.entropySource === entropySource,
    );

    if (sameAccount) {
      this.#logger.warn(
        'An account already exists with the same derivation path and entropy source. Skipping account creation.',
      );
      return sameAccount;
    }

    const derivedAccount = await this.#deriveAccount({
      entropySource,
      index: derivationIndex,
    });

    const account = {
      ...derivedAccount,
      options: {
        ...derivedAccount.options,
        groupIndex: derivationIndex,
      },
    };

    await this.#accountsRepository.save(account);

    // If a callback is provided, call it with the account
    // If the callback fails, delete the newly created account and re-throw the error
    if (callback) {
      try {
        await callback(account);
      } catch (error) {
        // Rollback: if callback fails, delete the account
        try {
          await this.#accountsRepository.delete(account.id);
        } catch (deleteError: unknown) {
          this.#logger.logErrorWithDetails(
            'Failed to rollback account creation',
            ensureError(deleteError),
          );
          throw new AccountRollbackException(account.id, account.address);
        }
        // Re-throw the error to be handled by the caller
        throw error;
      }
    }

    return account;
  }

  /**
   * Deletes a Stellar account by ID.
   *
   * @param id - The ID of the account to delete.
   * @returns A Promise that resolves when the account has been deleted.
   */
  async delete(id: string): Promise<void> {
    await this.#accountsRepository.delete(id);
  }

  /**
   * Lists all Stellar accounts in the keyring.
   *
   * @returns A Promise that resolves to the list of all accounts.
   */
  async listAccounts(): Promise<StellarKeyringAccount[]> {
    return await this.#accountsRepository.getAll();
  }

  /**
   * Finds a Stellar account by ID.
   *
   * @param id - The ID of the account to find.
   * @returns A Promise that resolves to the account if found, otherwise `undefined`.
   */
  async findById(id: string): Promise<StellarKeyringAccount | undefined> {
    return (await this.#accountsRepository.findById(id)) ?? undefined;
  }

  async #resolveKeyringAccountByAddress({
    scope,
    address,
  }: {
    scope: KnownCaip2ChainId;
    address: StellarAddress;
  }): Promise<StellarKeyringAccount> {
    const account = await this.#accountsRepository.findByAddressAndScope(
      address,
      scope,
    );
    if (!account) {
      throw new AccountNotFoundException(address);
    }
    return account;
  }

  async #resolveKeyringAccountById(
    accountId: string,
  ): Promise<StellarKeyringAccount> {
    const account = await this.#accountsRepository.findById(accountId);
    if (!account) {
      throw new AccountNotFoundException(accountId);
    }
    return account;
  }

  async #deriveAccount({
    entropySource,
    index,
  }: {
    entropySource: EntropySourceId;
    index: number;
  }): Promise<StellarKeyringAccount> {
    const derivationPath = getDerivationPath(index);
    const address = await this.#walletService.deriveAddress({
      entropySource,
      index,
    });
    return this.#toStellarKeyringAccount({
      entropySource,
      derivationPath,
      index,
      address,
    });
  }

  /**
   * Finds the lowest unused derivation index for the given entropy source.
   * Indexes are not guaranteed to be contiguous (accounts can be deleted), so this scans
   * existing accounts and returns the smallest index not yet in use.
   *
   * @param options - The parameters for the index search.
   * @param options.entropySource - The entropy source to scope the search.
   * @param options.accounts - The existing accounts to check against.
   * @returns The lowest unused index for that entropy source.
   */
  #getLowestUnusedIndex({
    entropySource,
    accounts,
  }: {
    entropySource: EntropySourceId;
    accounts: StellarKeyringAccount[];
  }): number {
    const sortedIndices: number[] = [];
    if (accounts.length > 0) {
      for (const account of accounts) {
        if (account.entropySource === entropySource) {
          sortedIndices.push(account.index);
        }
      }
      sortedIndices.sort((first, second) => first - second);
    }

    return getLowestIndex(sortedIndices);
  }

  #toStellarKeyringAccount({
    entropySource,
    derivationPath,
    index,
    address,
    id = globalThis.crypto.randomUUID(),
  }: {
    entropySource: EntropySourceId;
    derivationPath: StellarDerivationPath;
    index: number;
    address: string;
    id?: string;
  }): StellarKeyringAccount {
    return {
      id,
      entropySource,
      derivationPath,
      index,
      type: KEYRING_ACCOUNT_TYPE,
      address,
      // Only selected network is supported for now
      scopes: [AppConfig.selectedNetwork],
      options: {
        entropy: {
          type: 'mnemonic',
          id: entropySource,
          derivationPath,
          groupIndex: index,
        },
        exportable: true,
      },
      methods: [MultichainMethod.SignMessage, MultichainMethod.SignTransaction],
    };
  }
}
