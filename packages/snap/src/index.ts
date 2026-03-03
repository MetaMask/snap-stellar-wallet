import type {
  OnRpcRequestHandler,
  OnKeyringRequestHandler,
} from '@metamask/snaps-sdk';

import { keyringHandler, rpcHandler } from './context';
import { withCatchAndThrowSnapError } from './utils';

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) =>
  withCatchAndThrowSnapError(async () =>
    keyringHandler.handle(origin, request),
  );

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) =>
  withCatchAndThrowSnapError(async () => rpcHandler.handle(origin, request));
