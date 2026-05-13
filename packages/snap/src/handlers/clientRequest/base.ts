import type { Struct } from '@metamask/superstruct';
import type { Json, JsonRpcRequest } from '@metamask/utils';

import type { JsonRpcRequestWithAccount } from './api';
import { AccountNotActivatedException } from '../../services/network';
import { render as renderAccountActivationPrompt } from '../../ui/confirmation/views/AccountActivationPrompt/render';
import type { ILogger } from '../../utils/logger';
import type {
  AccountResolver,
  FullActivatedAccountResolveOptions,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { DEFAULT_RESOLVE_ACCOUNT_OPTIONS } from '../accountResolver';
import { BaseHandler } from '../base';
/**
 * Interface for the client request handler.
 */
export type IClientRequestHandler = {
  handle: (request: JsonRpcRequest) => Promise<Json>;
};

/**
 * Base class for client request handlers that resolve account context via an
 * {@link AccountResolver} constructed with matching {@link FullActivatedAccountResolveOptions} in
 * `context.ts`.
 */
export abstract class BaseClientRequestHandler<
  RequestType extends JsonRpcRequestWithAccount,
  ResponseType extends Json,
>
  extends BaseHandler<RequestType, ResponseType>
  implements IClientRequestHandler
{
  /**
   * Get the account ID from the JSON-RPC request.
   *
   * @param request - The JSON-RPC request to get the account ID from.
   * @returns The account ID.
   */
  protected getAccountId(request: RequestType): string {
    return request.params.accountId;
  }

  readonly #accountResolver: AccountResolver;

  readonly #resolveAccountOptions: FullActivatedAccountResolveOptions;

  constructor({
    logger,
    accountResolver,
    resolveAccountOptions = DEFAULT_RESOLVE_ACCOUNT_OPTIONS,
    requestStruct,
    responseStruct,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    resolveAccountOptions?: FullActivatedAccountResolveOptions;
    requestStruct: Struct<RequestType>;
    responseStruct: Struct<ResponseType>;
  }) {
    super({ logger, requestStruct, responseStruct });
    this.#accountResolver = accountResolver;
    this.#resolveAccountOptions = resolveAccountOptions;
  }

  protected abstract execute(
    resolved: ResolvedActivatedAccount,
    request: RequestType,
  ): Promise<ResponseType>;

  /**
   * Handles a JSON-RPC request by resolving an activated account and calling {@link execute}.
   *
   * @param request - The JSON-RPC request to handle.
   * @returns The result of {@link execute}.
   */
  protected async handleRequest(
    request: RequestType,
  ): Promise<ResponseType | Json> {
    const resolvedAccount = await this.resolveAccount(request);
    return await this.execute(resolvedAccount, request);
  }

  protected async resolveAccount(
    request: RequestType,
  ): Promise<ResolvedActivatedAccount> {
    try {
      return await this.#accountResolver.resolveAccount({
        accountId: this.getAccountId(request),
        options: this.#resolveAccountOptions,
      });
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        await this.handleAccountNotActivatedError(error);
      }
      throw error;
    }
  }

  async #showAccountNotActivatedAlert(address: string): Promise<void> {
    await renderAccountActivationPrompt(address);
  }

  /**
   * Handles the account not activated error by showing an alert.
   * Rethrows the error to be handled by the caller.
   *
   * @param error - The account not activated error.
   */
  protected async handleAccountNotActivatedError(
    error: AccountNotActivatedException,
  ): Promise<never> {
    await this.#showAccountNotActivatedAlert(error.address);
    throw error;
  }
}
