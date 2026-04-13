import type { Struct } from '@metamask/superstruct';
import type { Json, JsonRpcRequest } from '@metamask/utils';
import { ensureError } from '@metamask/utils';

import { AppConfig } from '../config';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../services/account';
import { AccountNotActivatedException } from '../services/network';
import type { OnChainAccountService } from '../services/on-chain-account';
import { OnChainAccount } from '../services/on-chain-account';
import type { WalletService } from '../services/wallet';
import { Wallet } from '../services/wallet';
import type { ILogger } from '../utils';
import { validateRequest, validateResponse } from '../utils';

export const DEFAULT_RESOLVE_ACCOUNT_OPTIONS = {
  onChainAccount: true,
  wallet: true,
} as const;

export type DefaultResolveAccountOptions =
  typeof DEFAULT_RESOLVE_ACCOUNT_OPTIONS;

export type ResolveAccountOptions = {
  /** Whether to load the activated on-chain account. */
  onChainAccount: boolean;
  /** Whether to load the wallet. */
  wallet: boolean;
};

export type ResolvedActivatedAccountFor<Opts extends ResolveAccountOptions> = {
  account: StellarKeyringAccount;
} & (Opts['onChainAccount'] extends true
  ? { onChainAccount: OnChainAccount }
  : unknown) &
  (Opts['wallet'] extends true ? { wallet: Wallet } : unknown);

/** Full resolution using {@link DEFAULT_RESOLVE_ACCOUNT_OPTIONS}. */
export type ResolvedActivatedAccount =
  ResolvedActivatedAccountFor<DefaultResolveAccountOptions>;

/**
 * A base class for client request handlers that require an activated account.
 */
export abstract class WithActiveAccountResolve<
  RequestType extends Json,
  ResponseType extends Json,
  Opts extends ResolveAccountOptions = DefaultResolveAccountOptions,
> {
  protected readonly logger: ILogger;

  protected readonly accountService: AccountService;

  protected readonly onChainAccountService: OnChainAccountService;

  protected readonly walletService: WalletService;

  protected readonly requestStruct: Struct<RequestType>;

  protected readonly responseStruct: Struct<ResponseType>;

  readonly #resolveAccountOptions: ResolveAccountOptions;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    requestStruct,
    responseStruct,
    resolveAccountOptions,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
    requestStruct: Struct<RequestType>;
    responseStruct: Struct<ResponseType>;
    /** Partial override; omitted flags default to {@link DEFAULT_RESOLVE_ACCOUNT_OPTIONS}. */
    resolveAccountOptions?: Partial<ResolveAccountOptions>;
  }) {
    this.logger = logger;
    this.accountService = accountService;
    this.onChainAccountService = onChainAccountService;
    this.walletService = walletService;
    this.requestStruct = requestStruct;
    this.responseStruct = responseStruct;
    this.#resolveAccountOptions = {
      onChainAccount:
        resolveAccountOptions?.onChainAccount ??
        DEFAULT_RESOLVE_ACCOUNT_OPTIONS.onChainAccount,
      wallet:
        resolveAccountOptions?.wallet ?? DEFAULT_RESOLVE_ACCOUNT_OPTIONS.wallet,
    };
  }

  protected abstract _handle(
    resolved: ResolvedActivatedAccountFor<Opts>,
    request: RequestType,
  ): Promise<ResponseType>;

  /**
   * Handles a JSON-RPC request by resolving an activated account and calling the _handle method.
   *
   * @param request - The JSON-RPC request to handle.
   * @returns The result of the _handle method.
   */
  async handle(
    request: RequestType | JsonRpcRequest | Json,
  ): Promise<ResponseType | Json> {
    this.logger.debug('Handling request', { request });

    const validatedRequest = validateRequest(request, this.requestStruct);

    let resolvedAccount: ResolvedActivatedAccountFor<Opts>;
    try {
      resolvedAccount = await this.resolveAccount(validatedRequest);
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return await this.handleAccountNotActivatedError(error);
      }
      throw ensureError(error);
    }

    let result: ResponseType | Json;
    try {
      result = await this._handle(resolvedAccount, validatedRequest);
    } catch (error: unknown) {
      this.logger.logErrorWithDetails('Error handling request', error);
      throw error;
    }

    this.logger.debug('Handled request', {
      result: JSON.stringify(result, null, 2),
    });

    validateResponse(result, this.responseStruct);

    return result;
  }

  protected async resolveAccount(
    request: RequestType,
  ): Promise<ResolvedActivatedAccountFor<Opts>> {
    const { onChainAccount: loadOnChain, wallet: loadWallet } =
      this.#resolveAccountOptions;

    const { account } = await this.accountService.resolveAccount({
      accountId: this.getAccountId(request),
    });

    const promises: Promise<OnChainAccount | Wallet>[] = [];

    if (loadOnChain) {
      promises.push(
        this.onChainAccountService.resolveOnChainAccount(
          account,
          AppConfig.selectedNetwork,
        ),
      );
    }
    if (loadWallet) {
      promises.push(this.walletService.resolveWallet(account));
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

  /**
   * Abstract method to get the account id from the request.
   *
   * @param request - The request to get the account id from.
   * @returns The account id.
   */
  protected abstract getAccountId(request: RequestType): string;

  async #showAccountNotActivatedAlert(): Promise<void> {
    // TODO: Implement account not activated alert
    throw new Error('Account not activated: user alert not implemented');
  }

  /**
   * Handles the account not activated error by showing an alert.
   * Rethrows the error to be handled by the caller.
   *
   * @param error - The account not activated error.
   * @returns A promise that resolves to the account not activated error.
   */
  protected async handleAccountNotActivatedError(
    error: AccountNotActivatedException,
  ): Promise<Json> {
    await this.#showAccountNotActivatedAlert();
    throw error;
  }
}
