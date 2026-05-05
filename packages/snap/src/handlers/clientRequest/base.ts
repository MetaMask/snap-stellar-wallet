import type { Json, JsonRpcRequest } from '@metamask/utils';

import type { JsonRpcRequestWithAccount } from './api';
import type {
  DefaultResolveAccountOptions,
  ResolveAccountOptions,
} from '../base';
import { WithActiveAccountResolve } from '../base';

/**
 * Interface for the client request handler.
 */
export type IClientRequestHandler = {
  handle: (request: JsonRpcRequest) => Promise<Json>;
};

/**
 * A base class for client request handlers that require an activated account.
 */
export abstract class WithClientRequestActiveAccountResolve<
  RequestType extends JsonRpcRequestWithAccount,
  ResponseType extends Json,
  Opts extends ResolveAccountOptions = DefaultResolveAccountOptions,
>
  extends WithActiveAccountResolve<RequestType, ResponseType, Opts>
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
}
