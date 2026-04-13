import type { Json } from '@metamask/utils';

import type {
  DefaultResolveAccountOptions,
  ResolveAccountOptions,
} from '../base';
import { WithActiveAccountResolve } from '../base';

/**
 * Interface for the client request handler.
 */
export type IKeyringRequestHandler = {
  handle: (request: Json) => Promise<Json>;
};

/**
 * A base class for keyring request handlers that require an activated account.
 */
export abstract class WithKeyringRequestActiveAccountResolve<
  RequestType extends { account: string },
  ResponseType extends Json,
  Opts extends ResolveAccountOptions = DefaultResolveAccountOptions,
>
  extends WithActiveAccountResolve<RequestType, ResponseType, Opts>
  implements IKeyringRequestHandler
{
  /**
   * Get the account ID from the JSON-RPC request.
   *
   * @param request - The JSON-RPC request to get the account ID from.
   * @returns The account ID.
   */
  protected getAccountId(request: RequestType): string {
    return request.account;
  }
}
