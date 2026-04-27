import type { Struct } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import type { Sep43ErrorEnvelope, Sep43Opts } from './api';
import { Sep43Error, Sep43ErrorCode, toSep43Error } from './exceptions';
import type { KnownCaip2ChainId } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { Wallet, WalletService } from '../../services/wallet';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';
import { validateRequest, validateResponse } from '../../utils/requestResponse';

/**
 * Interface for the client request handler.
 */
export type IKeyringRequestHandler = {
  handle: (request: Json) => Promise<Json>;
};

/**
 * Base class shared by the SEP-43 SignMessage and SignTransaction keyring
 * handlers.
 *
 * Provides common cross-cutting concerns: validates `opts.networkPassphrase`
 * (mainnet only), validates `scope` is mainnet, forbids `submit` / `submitUrl`
 * (snap is sign-only), resolves the keyring account by `opts.address` when
 * provided (otherwise falls back to the wrapper's `account` UUID), and wraps
 * thrown errors into the SEP-43 `error` envelope so the dapp always receives a
 * well-formed payload.
 *
 * SEP-43 is a sign-only protocol — no on-chain activation check is performed.
 * The dapp is responsible for ensuring the account exists on-chain before
 * constructing the transaction or message.
 *
 * Subclasses implement {@link execute} which performs the wallet signing and
 * returns the success-shaped fields. They never throw to the dapp directly.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export abstract class BaseSep43KeyringHandler<
  Request extends {
    scope: KnownCaip2ChainId;
    account: string;
    origin: string;
    request: { params: { opts?: Sep43Opts } };
  },
  Response extends Json & {
    signerAddress: string;
    error?: Sep43ErrorEnvelope;
  },
> implements IKeyringRequestHandler {
  protected readonly logger: ILogger;

  protected readonly accountService: AccountService;

  protected readonly walletService: WalletService;

  protected readonly requestStruct: Struct<Request>;

  protected readonly responseStruct: Struct<Response>;

  constructor({
    logger,
    accountService,
    walletService,
    loggerPrefix,
    requestStruct,
    responseStruct,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    loggerPrefix: string;
    requestStruct: Struct<Request>;
    responseStruct: Struct<Response>;
  }) {
    this.logger = createPrefixedLogger(logger, loggerPrefix);
    this.accountService = accountService;
    this.walletService = walletService;
    this.requestStruct = requestStruct;
    this.responseStruct = responseStruct;
  }

  /**
   * Top-level entry point. Runs the full pipeline (validate → resolve account
   * → execute) inside a single try/catch so every failure (including struct
   * validation) is serialized into the SEP-43 `error` envelope. The dapp
   * never sees a thrown JSON-RPC error.
   *
   * @param rawRequest - The unvalidated keyring request as forwarded by
   * `KeyringHandler.submitRequest` (or the dev `stellar_*` RPC aliases).
   * @returns The SEP-43 response with either the success fields or `error`
   * populated.
   */
  async handle(rawRequest: Json): Promise<Response> {
    let signerAddress = '';
    try {
      // Check submit/submitUrl on the raw JSON before validateRequest coerces
      // the opts struct and strips unknown fields. The snap is sign-only.
      const rawOpts = (
        (rawRequest as Record<string, unknown>)?.request as
          | Record<string, unknown>
          | undefined
      )?.params as Record<string, unknown> | undefined;
      const opts = rawOpts?.opts as Record<string, unknown> | undefined;
      if (opts?.submit !== undefined || opts?.submitUrl !== undefined) {
        throw new Sep43Error({
          code: Sep43ErrorCode.InvalidRequest,
          ext: ['This wallet does not submit transactions; use sign only.'],
        });
      }

      const request = validateRequest(rawRequest, this.requestStruct);

      const { account, wallet } = await this.resolveAccount(request);
      signerAddress = account.address;

      const result = await this.execute(request, { account, wallet });
      validateResponse(result, this.responseStruct);
      return result;
    } catch (error: unknown) {
      const sep43 = toSep43Error(error);
      this.logger.logErrorWithDetails('SEP-43 request failed', sep43);
      return this.toErrorResponse(signerAddress, sep43);
    }
  }

  /**
   * Subclass hook: do the actual signing.
   *
   * @param request - The validated request.
   * @param resolved - The resolved keyring account and signing wallet.
   * @returns The success-shaped response (no `error` field).
   */
  protected abstract execute(
    request: Request,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<Response>;

  /**
   * Subclass hook: shape an error-only response when everything fails.
   *
   * @param signerAddress - The resolved address (or empty string when unknown).
   * @param error - The classified SEP-43 error.
   * @returns The error response in the subclass's response shape.
   */
  protected abstract toErrorResponse(
    signerAddress: string,
    error: Sep43Error,
  ): Response;

  /**
   * Resolves the signing account.
   * Prefers `opts.address` when provided; otherwise uses the wrapper's
   * `account` UUID. When both are present, the resolved address must match.
   *
   * @param request - The keyring request.
   * @returns The resolved keyring account and signing wallet.
   */
  protected async resolveAccount(
    request: Request,
  ): Promise<{ account: StellarKeyringAccount; wallet: Wallet }> {
    const { account: accountId, scope } = request;
    const optsAddress = request.request.params.opts?.address;

    const { account } = optsAddress
      ? await this.accountService.resolveAccount({
          scope,
          accountAddress: optsAddress,
        })
      : await this.accountService.resolveAccount({ accountId });

    const wallet = await this.walletService.resolveWallet(account);
    return { account, wallet };
  }
}
