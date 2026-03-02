import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { MethodNotFoundError } from '@metamask/snaps-sdk';

export const onRpcRequest: OnRpcRequestHandler = async () => {
  throw new MethodNotFoundError() as Error;
};
