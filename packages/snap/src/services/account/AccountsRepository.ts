import type { StellarKeyringAccount } from './api';
import type { KnownCaip2ChainId } from '../../api';
import type { IStateManager } from '../state/IStateManager';

export type UnencryptedStateValue = {
  keyringAccounts: Record<string, StellarKeyringAccount>;
};

/**
 * Persists and retrieves Stellar keyring accounts in snap state.
 */
export class AccountsRepository {
  readonly #storageKey = 'keyringAccounts';

  readonly #state: IStateManager<UnencryptedStateValue>;

  constructor(state: IStateManager<UnencryptedStateValue>) {
    this.#state = state;
  }

  /**
   * Returns all accounts from the keyring state.
   *
   * @returns A Promise that resolves to all accounts.
   */
  async getAll(): Promise<StellarKeyringAccount[]> {
    const accounts = await this.#state.getKey<
      UnencryptedStateValue['keyringAccounts']
    >(this.#storageKey);

    return Object.values(accounts ?? {});
  }

  /**
   * Finds an account by ID.
   *
   * @param id - The ID of the account to find.
   * @returns A Promise that resolves to the account if found, otherwise `null`.
   */
  async findById(id: string): Promise<StellarKeyringAccount | null> {
    const accounts = await this.getAll();
    return (
      accounts.find(
        (account) => account.id.toLowerCase() === id.toLowerCase(),
      ) ?? null
    );
  }

  /**
   * Finds accounts by IDs.
   *
   * @param ids - The IDs of the accounts to find.
   * @returns A Promise that resolves to the accounts that match the given IDs.
   */
  async findByIds(ids: string[]): Promise<StellarKeyringAccount[]> {
    const accounts = await this.getAll();
    const idsSet = new Set(ids.map((id) => id.toLowerCase()));
    return accounts.filter((account) => idsSet.has(account.id.toLowerCase()));
  }

  /**
   * Finds an account by address.
   *
   * @param address - The Stellar address (public key) of the account to find.
   * @returns A Promise that resolves to the account if found, otherwise `null`.
   */
  async findByAddress(address: string): Promise<StellarKeyringAccount | null> {
    const accounts = await this.getAll();
    return (
      accounts.find(
        (account) => account.address.toLowerCase() === address.toLowerCase(),
      ) ?? null
    );
  }

  /**
   * Finds an account by address and network scope.
   *
   * @param address - The Stellar address of the account to find.
   * @param scope - The network scope (e.g. mainnet/testnet).
   * @returns A Promise that resolves to the account if found, otherwise `null`.
   */
  async findByAddressAndScope(
    address: string,
    scope: KnownCaip2ChainId,
  ): Promise<StellarKeyringAccount | null> {
    const accounts = await this.getAll();
    return (
      accounts.find(
        (account) =>
          account.address.toLowerCase() === address.toLowerCase() &&
          account.scopes.includes(scope),
      ) ?? null
    );
  }

  /**
   * Persists a new account in keyring state.
   *
   * @param account - The account to create.
   * @returns A Promise that resolves to the created account.
   */
  async create(account: StellarKeyringAccount): Promise<StellarKeyringAccount> {
    await this.#state.setKey(`${this.#storageKey}.${account.id}`, account);
    return account;
  }

  /**
   * Deletes an account by ID.
   *
   * @param id - The ID of the account to delete.
   * @returns A Promise that resolves when the account has been deleted.
   */
  async delete(id: string): Promise<void> {
    await this.#state.deleteKey(`${this.#storageKey}.${id}`);
  }
}
