import type { Struct } from '@metamask/superstruct';
import { Networks } from '@stellar/stellar-sdk';

import type { Sep43Opts } from './api';
import { Sep43Error, Sep43ErrorCode, toSep43Error } from './exceptions';
import type { KnownCaip2ChainId } from '../../api';
import { KnownCaip2ChainId as Caip2 } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { Wallet, WalletService } from '../../services/wallet';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';
import { validateRequest } from '../../utils/requestResponse';

/** Mainnet is the only network the snap currently signs for. */
const SUPPORTED_PASSPHRASE: string = Networks.PUBLIC;

/**
 * Base class shared by SEP-43 SignMessage and SignTransaction handlers.
 *
 * Provides common cross-cutting concerns: validates `opts.networkPassphrase`
 * (mainnet only), validates `scope` is mainnet (re-affirms what the middleware
 * already did), forbids `submit` / `submitUrl` (snap is sign-only), resolves
 * the keyring account by `opts.address` when provided (otherwise falls back to
 * the wrapper's `account` UUID), and wraps thrown errors into the SEP-43
 * `error` envelope so the dapp always receives a well-formed payload.
 *
 * Subclasses implement {@link execute} which performs the wallet signing and
 * returns the success-shaped fields. They never throw to the dapp directly.
 */
export abstract class BaseSep43Handler<
  Request extends {
    scope: KnownCaip2ChainId;
    account: string;
    request: { params: { opts?: Sep43Opts } };
  },
  Response extends { signerAddress: string; error?: unknown },
> {
  protected readonly logger: ILogger;

  protected readonly accountService: AccountService;

  protected readonly walletService: WalletService;

  protected readonly requestStruct: Struct<Request>;

  constructor({
    logger,
    accountService,
    walletService,
    loggerPrefix,
    requestStruct,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    loggerPrefix: string;
    requestStruct: Struct<Request>;
  }) {
    this.logger = createPrefixedLogger(logger, loggerPrefix);
    this.accountService = accountService;
    this.walletService = walletService;
    this.requestStruct = requestStruct;
  }

  /**
   * Top-level entry point. Runs the full pipeline (validate → override origin
   * → check network/opts → resolve account → execute) inside a single try/catch
   * so every failure (including struct validation) is serialized into the
   * SEP-43 `error` envelope. The dapp never sees a thrown JSON-RPC error.
   *
   * @param rawRequest - The unvalidated SEP-43 request as it arrives from the dapp.
   * @param trustedOrigin - The verified origin provided by MetaMask's `onRpcRequest`
   * handler. Overrides the dapp-supplied `params.origin` so the confirmation UI
   * cannot be spoofed by a malicious dapp.
   * @returns The SEP-43 response with either the success fields or `error` populated.
   */
  async handle(rawRequest: unknown, trustedOrigin: string): Promise<Response> {
    let signerAddress = '';
    try {
      const request = validateRequest(rawRequest, this.requestStruct);

      // Override the dapp-supplied origin with the MM-verified one.
      const verifiedRequest = { ...request, origin: trustedOrigin };

      this.assertSupportedNetwork(verifiedRequest);
      this.assertNoSubmit(verifiedRequest.request.params.opts);

      const { account, wallet } = await this.resolveAccount(verifiedRequest);
      signerAddress = account.address;

      return await this.execute(verifiedRequest, { account, wallet });
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
   * Prefers `opts.address` when provided; otherwise uses the wrapper's `account` UUID.
   * When both are present, the resolved address must match.
   *
   * @param request - The SEP-43 request.
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

    if (optsAddress && account.id !== accountId) {
      // The dapp picked an address that doesn't match the session-selected account.
      throw new Sep43Error({
        code: Sep43ErrorCode.InvalidRequest,
        ext: [
          `opts.address ${optsAddress} does not match the session-selected account.`,
        ],
      });
    }

    const wallet = await this.walletService.resolveWallet(account);
    return { account, wallet };
  }

  /**
   * Throws when the dapp asks for a network we don't support.
   * Today: mainnet only. The snap rejects any other `opts.networkPassphrase`
   * and any non-mainnet `scope`.
   *
   * @param request - The SEP-43 request.
   */
  protected assertSupportedNetwork(request: Request): void {
    if (request.scope !== Caip2.Mainnet) {
      throw new Sep43Error({
        code: Sep43ErrorCode.InvalidRequest,
        ext: [`Only mainnet is supported, received scope ${request.scope}.`],
      });
    }

    const requestedPassphrase = request.request.params.opts?.networkPassphrase;
    if (
      requestedPassphrase !== undefined &&
      requestedPassphrase !== SUPPORTED_PASSPHRASE
    ) {
      throw new Sep43Error({
        code: Sep43ErrorCode.InvalidRequest,
        ext: [
          `Only Stellar mainnet is supported by this wallet. Received passphrase: ${requestedPassphrase}.`,
        ],
      });
    }
  }

  /**
   * Throws when the dapp set `submit` or `submitUrl`. The snap is sign-only.
   *
   * @param opts - The SEP-43 opts bag (may be undefined).
   */
  protected assertNoSubmit(opts: Sep43Opts | undefined): void {
    // Use property access to detect even runtime-injected fields the struct stripped.
    const raw = opts as undefined | Record<string, unknown>;
    if (raw?.submit !== undefined || raw?.submitUrl !== undefined) {
      throw new Sep43Error({
        code: Sep43ErrorCode.InvalidRequest,
        ext: ['This wallet does not submit transactions; use sign only.'],
      });
    }
  }
}
