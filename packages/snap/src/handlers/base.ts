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
import { render as renderAccountActivationPrompt } from '../ui/confirmation/views/AccountActivationPrompt/render';
import type { ILogger } from '../utils';
import { serializeToString, validateRequest, validateResponse } from '../utils';

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

export abstract class BaseHandler<
  RequestType extends Json,
  ResponseType extends Json,
> {
  protected readonly requestStruct: Struct<RequestType>;

  protected readonly responseStruct: Struct<ResponseType>;

  protected readonly logger: ILogger;

  constructor({
    logger,
    requestStruct,
    responseStruct,
  }: {
    logger: ILogger;
    requestStruct: Struct<RequestType>;
    responseStruct: Struct<ResponseType>;
  }) {
    this.logger = logger;
    this.requestStruct = requestStruct;
    this.responseStruct = responseStruct;
  }

  protected abstract handleRequest(
    request: RequestType,
  ): Promise<ResponseType | Json>;

  /**
   * Handles a JSON-RPC request by resolving an activated account and calling the _handle method.
   *
   * @param request - The JSON-RPC request to handle.
   * @returns The result of the _handle method.
   */
  async handle(
    request: RequestType | JsonRpcRequest | Json,
  ): Promise<ResponseType | Json> {
    this.logger.debug('Handling request', {
      request: serializeToString({ value: request }),
    });

    const validatedRequest = validateRequest(request, this.requestStruct);

    let result: ResponseType | Json;
    try {
      this.logger.debug(`Starting handle transformed request`, {
        request: serializeToString({ value: validatedRequest }),
      });
      result = await this.handleRequest(validatedRequest);
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'Error handling request',
        ensureError(error).message,
      );
      throw error;
    }

    this.logger.debug('Handled request', {
      result: serializeToString({ value: result }),
    });

    validateResponse(result, this.responseStruct);

    return result;
  }
}
/**
 * A base class for client request handlers that require an activated account.
 */
export abstract class WithActiveAccountResolve<
  RequestType extends Json,
  ResponseType extends Json,
  Opts extends ResolveAccountOptions = DefaultResolveAccountOptions,
> extends BaseHandler<RequestType, ResponseType> {
  protected readonly accountService: AccountService;

  protected readonly onChainAccountService: OnChainAccountService;

  protected readonly walletService: WalletService;

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
    super({ logger, requestStruct, responseStruct });
    this.accountService = accountService;
    this.onChainAccountService = onChainAccountService;
    this.walletService = walletService;
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
  protected async handleRequest(
    request: RequestType,
  ): Promise<ResponseType | Json> {
    this.logger.debug('resolve account request', {
      resolveOptions: this.#resolveAccountOptions,
    });

    let resolvedAccount: ResolvedActivatedAccountFor<Opts>;
    try {
      resolvedAccount = await this.resolveAccount(request);
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return await this.handleAccountNotActivatedError(error);
      }
      throw ensureError(error);
    }
    return await this._handle(resolvedAccount, request);
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

  async #showAccountNotActivatedAlert(address: string): Promise<void> {
    await renderAccountActivationPrompt(address);
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
    await this.#showAccountNotActivatedAlert(error.address);
    throw error;
  }
}
