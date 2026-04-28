import type { Struct } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';

import type { Sep43ErrorEnvelope, Sep43Opts } from './api';
import type { Sep43Error } from './exceptions';
import { toSep43Error } from './exceptions';
import type { KnownCaip2ChainId } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { Wallet, WalletService } from '../../services/wallet';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';
import { validateRequest, validateResponse } from '../../utils/requestResponse';
import { BaseHandler } from '../base';

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
 * Extends {@link BaseHandler} for codebase consistency (inherits
 * `logger` / `requestStruct` / `responseStruct`) but overrides `handle()`:
 * `BaseHandler.handle()` throws on validation/handler errors, whereas SEP-43
 * must serialize every failure into the response `error` envelope so the
 * dapp always receives a well-formed payload.
 *
 * SEP-43 is a sign-only protocol — no on-chain activation check is performed.
 * The dapp is responsible for ensuring the account exists on-chain before
 * constructing the transaction or message.
 *
 * Subclasses implement {@link execute} which performs the wallet signing and
 * returns the success-shaped fields.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export abstract class BaseSep43KeyringHandler<
  Request extends Json & {
    scope: KnownCaip2ChainId;
    account: string;
    origin: string;
    request: { params: { opts?: Sep43Opts } };
  },
  Response extends Json & {
    signerAddress: string;
    error?: Sep43ErrorEnvelope;
  },
>
  extends BaseHandler<Request, Response>
  implements IKeyringRequestHandler
{
  protected readonly accountService: AccountService;

  protected readonly walletService: WalletService;

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
    super({
      logger: createPrefixedLogger(logger, loggerPrefix),
      requestStruct,
      responseStruct,
    });
    this.accountService = accountService;
    this.walletService = walletService;
  }

  /**
   * Top-level entry point. Runs the full pipeline (validate → resolve account
   * → execute) inside a single try/catch so every failure (including struct
   * validation) is serialized into the SEP-43 `error` envelope. The dapp
   * never sees a thrown JSON-RPC error.
   *
   * @param rawRequest - The unvalidated keyring request as forwarded by
   * `KeyringHandler.submitRequest`.
   * @returns The SEP-43 response with either the success fields or `error`
   * populated.
   */
  override async handle(rawRequest: Json): Promise<Response> {
    let signerAddress = '';
    try {
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
   * Implements {@link BaseHandler.handleRequest}. Not on the SEP-43 hot path
   * (the {@link handle} override calls {@link execute} directly so that
   * `signerAddress` can be captured for the error envelope), but kept as a
   * sane delegation for any caller that invokes `super.handle()`.
   *
   * @param request - The validated request.
   * @returns The execute result.
   */
  protected async handleRequest(request: Request): Promise<Response> {
    const { account, wallet } = await this.resolveAccount(request);
    return await this.execute(request, { account, wallet });
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
   * Resolves the signing account by the keyring `account` UUID. The keyring
   * framework has already mapped the dapp's selection to a UUID, so we trust
   * it as the single source of truth — `opts.address` is intentionally not
   * honored to avoid letting the dapp redirect the signer.
   *
   * @param request - The keyring request.
   * @returns The resolved keyring account and signing wallet.
   */
  protected async resolveAccount(
    request: Request,
  ): Promise<{ account: StellarKeyringAccount; wallet: Wallet }> {
    const { account: accountId } = request;
    const { account } = await this.accountService.resolveAccount({ accountId });
    const wallet = await this.walletService.resolveWallet(account);
    return { account, wallet };
  }
}
