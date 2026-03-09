import type { EntropySourceId, KeyringAccount } from '@metamask/keyring-api';

import type { IStateManager } from '../state/IStateManager';
import type { StellarDerivationPath } from '../wallet/KeypairService';

export type StellarKeyringAccount = KeyringAccount & {
  entropySource: EntropySourceId;
  derivationPath: StellarDerivationPath;
  index: number;
};

export type UnencryptedStateValue = {
  keyringAccounts: Record<string, StellarKeyringAccount>;
};

export class AccountsRepository {
  readonly #storageKey = 'keyringAccounts';

  readonly #state: IStateManager<UnencryptedStateValue>;

  constructor(state: IStateManager<UnencryptedStateValue>) {
    this.#state = state;
  }

  /**
   * Returns all accounts from the state.
   *
   * @returns All accounts from the state.
   */
  async getAll(): Promise<StellarKeyringAccount[]> {
    const accounts = await this.#state.getKey<
      UnencryptedStateValue['keyringAccounts']
    >(this.#storageKey);

    return Object.values(accounts ?? {});
  }

  /**
   * Finds an account by its id.
   *
   * @param id - The id of the account to find.
   * @returns The account if found, otherwise null.
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
   * Finds accounts by their ids.
   *
   * @param ids - The ids of the accounts to find.
   * @returns The accounts if found, otherwise null.
   */
  async findByIds(ids: string[]): Promise<StellarKeyringAccount[] | null> {
    const accounts = await this.getAll();
    const idsSet = new Set(ids.map((id) => id.toLowerCase()));
    return (
      accounts.filter((account) => idsSet.has(account.id.toLowerCase())) ?? null
    );
  }

  /**
   * Finds an account by its address.
   *
   * @param address - The address of the account to find.
   * @returns The account if found, otherwise null.
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
   * Creates a new account.
   *
   * @param account - The account to create.
   * @returns The created account.
   */
  async create(account: StellarKeyringAccount): Promise<StellarKeyringAccount> {
    await this.#state.setKey(`${this.#storageKey}.${account.id}`, account);
    return account;
  }

  /**
   * Deletes an account by its id.
   *
   * @param id - The id of the account to delete.
   * @returns The deleted account.
   */
  async delete(id: string): Promise<void> {
    await Promise.all([this.#state.deleteKey(`${this.#storageKey}.${id}`)]);
  }
}
