import type { EntropySourceId } from '@metamask/keyring-api';

import type { AccountsRepository } from './AccountsRepository';
import type { StellarKeyringAccount, StellarDerivationPath } from './api';
import { getDerivationPath } from './derivation';
import { KnownCaip2ChainId, MultichainMethod } from '../../api';
import type { StellarAddress } from '../../api';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getDefaultEntropySource,
  getLowestIndex,
} from '../../utils';
import type { Wallet, WalletService } from '../wallet';
import {
  DerivedAccountAddressMismatchException,
  AccountNotFoundException,
} from './exceptions';

/**
 * Manages Stellar keyring accounts: discovery, creation, resolution, and persistence.
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
   * Derives an account from the given entropy source and index, then checks whether that address
   * is activated on Stellar, regardless of whether the account exists in keyring state.
   *
   * @param options - The parameters for the account discovery.
   * @param options.entropySource - The entropy source used to derive the account.
   * @param options.index - The derivation index of the account to discover.
   * @param options.scope - The network scope (e.g. mainnet/testnet).
   * @returns A Promise that resolves to the derived account if it is activated on Stellar, otherwise `null`.
   */
  async discoverOnChainAccount({
    entropySource,
    index,
    scope,
  }: {
    entropySource: EntropySourceId;
    index: number;
    scope: KnownCaip2ChainId;
  }): Promise<StellarKeyringAccount | null> {
    // Derive the account by the given entropy source and index.
    const account = await this.#deriveAccount({ entropySource, index });

    // Verify the account is activated in the Stellar network.
    const isActivated = await this.#walletService.isAccountActivated({
      address: account.address,
      scope,
    });

    if (!isActivated) {
      return null;
    }

    return account;
  }

  /**
   * Resolves an account from a given scope and address by:
   * - If `activated` is true, resolving an account from state and an activated account from the network.
   * - If `activated` is false, resolving an account from state only.
   *
   * @param params - The parameters for the account resolution.
   * @param params.scope - The scope of the account to resolve.
   * @param params.address - The address of the account to resolve.
   * @param params.resolveOptions - Resolution options.
   * @param params.resolveOptions.activated - When true, also resolves the activated wallet from the network; return type then includes required `wallet`.
   * @returns A Promise that resolves to the resolved account and optional wallet (wallet present when `activated` is true).
   * @throws If the account is not found in the keyring state.
   * @throws If the address is not the same as the derived account address.
   * @throws If the account is not activated on the Stellar network when `activated` is true.
   */
  async resolveAccount<ResolveActivatedAccount extends boolean>({
    scope,
    address,
    resolveOptions,
  }: {
    scope: KnownCaip2ChainId;
    address: StellarAddress;
    resolveOptions: {
      activated: ResolveActivatedAccount;
    };
  }): Promise<
    ResolveActivatedAccount extends true
      ? { account: StellarKeyringAccount; wallet: Wallet }
      : { account: StellarKeyringAccount; wallet?: Wallet }
  > {
    this.#logger.debug('Resolving account address', { scope, address });

    let wallet: Wallet | undefined;
    let derivedAddress: StellarAddress | undefined;
    const { activated } = resolveOptions;

    // Verify the address is associated with an account in the state that matches the scope.
    const account = await this.#resolveKeyringAccount({ scope, address });
    const { entropySource, index } = account;

    // Verify the account is activated in the Stellar network if `activated` is true.
    // Otherwise, derive the address from the entropy source and index.
    if (activated) {
      wallet = await this.#walletService.resolveActivatedAccount({
        scope,
        entropySource,
        index,
      });
      derivedAddress = wallet.address;
    } else {
      derivedAddress = await this.#walletService.deriveAddress({
        entropySource,
        index,
      });
    }

    // Verify the address is the same as the derived account address.
    this.#assertSameAddress(address, derivedAddress);

    return {
      account,
      wallet,
    } as ResolveActivatedAccount extends true
      ? { account: StellarKeyringAccount; wallet: Wallet }
      : { account: StellarKeyringAccount; wallet?: Wallet };
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
   * Deletes a Stellar account by ID.
   *
   * @param id - The ID of the account to delete.
   * @returns A Promise that resolves when the account has been deleted.
   */
  async delete(id: string): Promise<void> {
    this.#logger.debug('Deleting account', { id });
    await this.#accountsRepository.delete(id);
  }

  /**
   * Lists all Stellar accounts in the keyring.
   *
   * @returns A Promise that resolves to the list of all accounts.
   */
  async listAccounts(): Promise<StellarKeyringAccount[]> {
    this.#logger.debug('Listing accounts');
    return await this.#accountsRepository.getAll();
  }

  /**
   * Finds a Stellar account by ID.
   *
   * @param id - The ID of the account to find.
   * @returns A Promise that resolves to the account if found, otherwise `undefined`.
   */
  async findById(id: string): Promise<StellarKeyringAccount | undefined> {
    this.#logger.debug('Finding account by ID', { id });
    return (await this.#accountsRepository.findById(id)) ?? undefined;
  }

  async #resolveKeyringAccount({
    scope,
    address,
  }: {
    scope: KnownCaip2ChainId;
    address: StellarAddress;
  }): Promise<StellarKeyringAccount> {
    this.#logger.debug('Resolving keyring account', { scope, address });

    const account = await this.#accountsRepository.findByAddressAndScope(
      address,
      scope,
    );
    if (!account) {
      throw new AccountNotFoundException(address, scope);
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
      methods: [MultichainMethod.SignMessage, MultichainMethod.SignTransaction],
    };
  }

  #assertSameAddress(
    address: StellarAddress,
    derivedAddress: StellarAddress,
  ): void {
    if (address.toLowerCase() !== derivedAddress.toLowerCase()) {
      throw new DerivedAccountAddressMismatchException(address);
    }
  }
}
