import type { Struct } from '@metamask/superstruct';
import type { Json } from '@metamask/utils';
import { Networks } from '@stellar/stellar-sdk';

import type { Sep43ErrorEnvelope, Sep43Opts } from './api';
import { Sep43Error, Sep43ErrorCode, toSep43Error } from './exceptions';
import type { KnownCaip2ChainId } from '../../api';
import { KnownCaip2ChainId as Caip2 } from '../../api';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import { AccountNotActivatedException } from '../../services/network';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { Wallet, WalletService } from '../../services/wallet';
import { render as renderAccountActivationPrompt } from '../../ui/confirmation/views/AccountActivationPrompt/render';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';
import { validateRequest, validateResponse } from '../../utils/requestResponse';

/**
 * Interface for the client request handler.
 */
export type IKeyringRequestHandler = {
  handle: (request: Json) => Promise<Json>;
};

/** Mainnet is the only network the snap currently signs for. */
const SUPPORTED_PASSPHRASE: string = Networks.PUBLIC;

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
 * After the keyring account is resolved, {@link OnChainAccountService} is used
 * the same way as other activated-account flows: an unfunded ledger account
 * triggers the account-activation UI, then a SEP-43 `error` (not a JSON-RPC
 * error) is returned.
 *
 * `request.origin` is the dapp or wallet caller origin already validated by
 * MetaMask before the snap runs; the confirmation UI uses it for display only.
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

  protected readonly onChainAccountService: OnChainAccountService;

  protected readonly requestStruct: Struct<Request>;

  protected readonly responseStruct: Struct<Response>;

  constructor({
    logger,
    accountService,
    walletService,
    onChainAccountService,
    loggerPrefix,
    requestStruct,
    responseStruct,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    onChainAccountService: OnChainAccountService;
    loggerPrefix: string;
    requestStruct: Struct<Request>;
    responseStruct: Struct<Response>;
  }) {
    this.logger = createPrefixedLogger(logger, loggerPrefix);
    this.accountService = accountService;
    this.walletService = walletService;
    this.onChainAccountService = onChainAccountService;
    this.requestStruct = requestStruct;
    this.responseStruct = responseStruct;
  }

  /**
   * Top-level entry point. Runs the full pipeline (validate → check
   * network/opts → resolve account → execute) inside a single try/catch so
   * every failure (including struct validation) is serialized into the SEP-43
   * `error` envelope. The dapp never sees a thrown JSON-RPC error.
   *
   * @param rawRequest - The unvalidated keyring request as forwarded by
   * `KeyringHandler.submitRequest` (or the dev `stellar_*` RPC aliases). The
   * wrapper's `origin` is the caller origin MetaMask attached; treat it as
   * system-trusted for labeling in confirmation UI, not as a crypto capability.
   * @returns The SEP-43 response with either the success fields or `error`
   * populated.
   */
  async handle(rawRequest: Json): Promise<Response> {
    let signerAddress = '';
    try {
      const request = validateRequest(rawRequest, this.requestStruct);

      this.assertSupportedNetwork(request);
      this.assertNoSubmit(request.request.params.opts);

      const { account, wallet } = await this.resolveAccount(request);
      signerAddress = account.address;

      await this.assertAccountActivatedOnChain(request, account);

      const result = await this.execute(request, { account, wallet });
      validateResponse(result, this.responseStruct);
      return result;
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        await renderAccountActivationPrompt(error.address);
      }
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

    if (optsAddress && account.id !== accountId) {
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
   * @param request - The keyring request.
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

  /**
   * Ensures the account exists on the Stellar network (funded) before signing.
   * Aligns with the `WithActiveAccountResolve` path in `handlers/base.ts` for
   * non-SEP-43 client routes.
   *
   * @param request - The validated keyring request (used for `scope`).
   * @param account - The resolved keyring account.
   */
  protected async assertAccountActivatedOnChain(
    request: Request,
    account: StellarKeyringAccount,
  ): Promise<void> {
    await this.onChainAccountService.resolveOnChainAccount(
      account.address,
      request.scope,
    );
  }
}
