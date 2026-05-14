import type { KnownCaip2ChainId } from '../api';
import { AppConfig } from '../config';
import {
  assertSameAddress,
  type AccountService,
  type StellarKeyringAccount,
} from '../services/account';
import { AccountNotActivatedException } from '../services/network/exceptions';
import type { OnChainAccountService } from '../services/on-chain-account';
import { OnChainAccount } from '../services/on-chain-account';
import type { WalletService } from '../services/wallet';
import { Wallet } from '../services/wallet';

export enum ResolveAccountSource {
  OnChain = 'on-chain',
  State = 'state',
}

export type ResolveAccountOptions = {
  /** Whether to load the activated on-chain account. */
  onChainAccount: {
    load: boolean;
    source: ResolveAccountSource;
  };
  /** Whether to load the wallet. */
  wallet: boolean;
};

/**
 * Default resolve account options.
 * Load the activated on-chain account and the wallet.
 */
export const DEFAULT_RESOLVE_ACCOUNT_OPTIONS = {
  onChainAccount: {
    load: true,
    source: ResolveAccountSource.OnChain,
  },
  wallet: true,
} as const;

/** Keyring account + wallet only (`onChainAccount` is not loaded). */
export const RESOLVE_ACCOUNT_KEYRING_AND_WALLET = {
  onChainAccount: {
    load: false,
    source: ResolveAccountSource.OnChain,
  },
  wallet: true,
} as const satisfies ResolveAccountOptions;

/**
 * Keyring account + wallet + on-chain snapshot loaded from snap state (keyring account id).
 * Missing state is treated as not activated ({@link AccountNotActivatedException}).
 */
export const RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE = {
  onChainAccount: {
    load: true,
    source: ResolveAccountSource.State,
  },
  wallet: true,
} as const satisfies ResolveAccountOptions;

export type ResolvedActivatedAccountFor<Opts extends ResolveAccountOptions> = {
  account: StellarKeyringAccount;
} & (Opts['onChainAccount']['load'] extends true
  ? { onChainAccount: OnChainAccount }
  : unknown) &
  (Opts['wallet'] extends true ? { wallet: Wallet } : unknown);

/** Resolved keyring account + wallet when using {@link RESOLVE_ACCOUNT_KEYRING_AND_WALLET}. */
export type ResolvedKeyringAndWalletOnly = ResolvedActivatedAccountFor<
  typeof RESOLVE_ACCOUNT_KEYRING_AND_WALLET
>;

/**
 * Resolve-account presets that always load keyring account, wallet, and on-chain account data.
 * {@link ResolvedActivatedAccount} is defined from this union so options and resolved shape stay aligned.
 */
export type FullActivatedAccountResolveOptions =
  | typeof DEFAULT_RESOLVE_ACCOUNT_OPTIONS
  | typeof RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE;

/** Resolved account, on-chain state, and wallet for {@link FullActivatedAccountResolveOptions}. */
export type ResolvedActivatedAccount =
  ResolvedActivatedAccountFor<FullActivatedAccountResolveOptions>;

export class AccountResolver {
  readonly #accountService: AccountService;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #walletService: WalletService;

  constructor({
    accountService,
    onChainAccountService,
    walletService,
  }: {
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
  }) {
    this.#accountService = accountService;
    this.#onChainAccountService = onChainAccountService;
    this.#walletService = walletService;
  }

  async resolveAccount<Opts extends ResolveAccountOptions>({
    accountId,
    scope = AppConfig.selectedNetwork,
    options,
  }: {
    accountId: string;
    scope?: KnownCaip2ChainId;
    options: Opts;
  }): Promise<ResolvedActivatedAccountFor<Opts>> {
    const { onChainAccount: loadOnChain, wallet: loadWallet } = options;

    const { account } = await this.#accountService.resolveAccount({
      accountId,
    });

    const promises: Promise<OnChainAccount | Wallet>[] = [];

    if (loadOnChain.load) {
      promises.push(
        this.#loadOnChainAccount(account, scope, loadOnChain.source),
      );
    }
    if (loadWallet) {
      promises.push(this.#walletService.resolveWallet(account));
    }

    const entries = await Promise.all(promises);

    const onChainAccount = entries.find(
      (entry): entry is OnChainAccount => entry instanceof OnChainAccount,
    );
    const wallet = entries.find(
      (entry): entry is Wallet => entry instanceof Wallet,
    );

    return {
      account,
      ...(onChainAccount === undefined ? {} : { onChainAccount }),
      ...(wallet === undefined ? {} : { wallet }),
    } as ResolvedActivatedAccountFor<Opts>;
  }

  async #loadOnChainAccount(
    account: StellarKeyringAccount,
    scope: KnownCaip2ChainId,
    source: ResolveAccountSource,
  ): Promise<OnChainAccount> {
    if (source === ResolveAccountSource.OnChain) {
      return this.#onChainAccountService.resolveOnChainAccount(
        account.address,
        scope,
      );
    }
    const onChainAccount =
      await this.#onChainAccountService.resolveOnChainAccountByKeyringAccountId(
        account.id,
        scope,
      );
    // It is a tradeoff when loading on-chain account from state,
    // The account data can be omit from state, either because it is not synced yet, or because it is not activated,
    // in this case, we assume it is not activated
    if (onChainAccount === null) {
      throw new AccountNotActivatedException(account.address, scope);
    }

    assertSameAddress(account.address, onChainAccount?.accountId);

    return onChainAccount;
  }
}
