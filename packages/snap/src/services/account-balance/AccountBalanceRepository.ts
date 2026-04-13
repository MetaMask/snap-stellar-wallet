import type {
  AccountBalance,
  AccountBalanceRecord,
  AccountBalanceState,
} from './api';
import type { State } from '../state/State';

export class AccountBalanceRepository {
  readonly #state: State<AccountBalanceState>;

  readonly #stateKey = 'accountBalances';

  constructor(state: State<AccountBalanceState>) {
    this.#state = state;
  }

  async findByAccountId(
    accountId: string,
  ): Promise<AccountBalanceRecord | null> {
    const raw = await this.#state.getKey<AccountBalanceRecord>(
      `${this.#stateKey}.${accountId}`,
    );

    return raw ?? null;
  }

  async save(accountId: string, balances: AccountBalance): Promise<void> {
    await this.#state.setKey(`${this.#stateKey}.${accountId}`, {
      balances,
      persistedAt: Date.now(),
    });
  }

  /**
   * Writes one {@link AccountBalanceRecord} per keyring account via `snap_setState` (no full-state `update`).
   * Replaces the stored `balances` map for each id with the given payload.
   *
   * @param accountBalances - Map of keyring account id → full per-asset balance snapshot for that account.
   */
  async saveMany(
    accountBalances: Record<string, AccountBalance>,
  ): Promise<void> {
    const now = Date.now();
    await Promise.all(
      Object.entries(accountBalances).map(async ([accountId, balances]) =>
        this.#state.setKey(`${this.#stateKey}.${accountId}`, {
          balances,
          persistedAt: now,
        }),
      ),
    );
  }
}
