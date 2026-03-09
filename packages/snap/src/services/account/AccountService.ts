import type { EntropySourceId } from '@metamask/keyring-api';

import type {
  AccountsRepository,
  StellarKeyringAccount,
} from './AccountsRepository';
import { KnownCaip2ChainId } from '../../constants';
import type { CreateAccountOptions } from '../../handlers/keyring/types';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getDefaultEntropySource,
  getLowestIndex,
} from '../../utils';
import type {
  KeypairService,
  StellarDerivationPath,
} from '../wallet/KeypairService';

export class AccountService {
  readonly #logger: ILogger;

  readonly #keypairService: KeypairService;

  readonly #accountsRepository: AccountsRepository;

  constructor({
    logger,
    keypairService,
    accountsRepository,
  }: {
    logger: ILogger;
    keypairService: KeypairService;
    accountsRepository: AccountsRepository;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 AccountService]');
    this.#keypairService = keypairService;
    this.#accountsRepository = accountsRepository;
  }

  /**
   * Derives a Stellar account from a given entropy source and index.
   *
   * @param params - The parameters for the account derivation.
   * @param params.entropySource - The entropy source to use for account derivation.
   * @param params.index - The index of the account to derive.
   * @returns A Promise that resolves to the derived account.
   */
  async deriveAccount({
    entropySource,
    index,
  }: {
    entropySource: EntropySourceId;
    index: number;
  }): Promise<StellarKeyringAccount> {
    const { address, derivationPath } =
      await this.#keypairService.deriveAddress({
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
   * Creates a Stellar account with the given create-account options.
   *
   * @param options - The options for the account creation.
   * @param options.entropySource - The entropy source to use for account derivation.
   * @param options.index - The index of the account to derive.
   * @param options.addressType - The address type to use for account derivation.
   * @param options.scope - The scope to use for account derivation.
   * @param options.metamask - The metamask options to use for account derivation.
   * @param options.metamask.correlationId - The correlation ID to use for account derivation.
   * @param callback - The callback to call after the account is created.
   * @returns A Promise that resolves to the created account.
   */
  async create(
    options?: CreateAccountOptions,
    callback?: (account: StellarKeyringAccount) => Promise<void>,
  ): Promise<StellarKeyringAccount> {
    this.#logger.debug('Creating account', { options });

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
      return this.#toStellarKeyringAccount(sameAccount);
    }

    const derivedAccount = await this.deriveAccount({
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

    await this.#accountsRepository.create(account);

    // If a callback is provided, call it with the account
    // If the callback fails, delete the newly created account and re-throw the error
    if (callback && typeof callback === 'function') {
      try {
        await callback(account);
      } catch (error) {
        // Rollback: if callback fails, delete the account
        await this.#accountsRepository.delete(account.id);
        // Re-throw the error to be handled by the caller
        throw error;
      }
    }

    return account;
  }

  /**
   * Deletes a Stellar account from a given id.
   *
   * @param id - The id of the account to delete.
   * @returns A Promise that resolves when the account is deleted.
   */
  async delete(id: string): Promise<void> {
    this.#logger.debug('Deleting account', { id });
    await this.#accountsRepository.delete(id);
  }

  /**
   * Finds the lowest unused index for a given entropy source and accounts.
   *
   * Generating a new index for the KeyringAccount is not as straightforward as one might think.
   * We cannot assume that this number will continuously increase because one can delete an account with
   * an index in the middle of the list. The right way to do it is to find the lowest index that is
   * not yet used.
   *
   * @param params - The parameters for the index finding.
   * @param params.entropySource - The entropy source to use for account derivation.
   * @param params.accounts - The accounts to check.
   * @returns The lowest unused index.
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
      // TODO: Replace with the actual account type
      type: 'any:account',
      address,
      scopes: [KnownCaip2ChainId.Mainnet],
      options: {
        entropy: {
          type: 'mnemonic',
          id: entropySource,
          derivationPath,
          groupIndex: index,
        },
        exportable: true,
      },
      methods: ['signMessage', 'signTransaction'],
    };
  }
}
