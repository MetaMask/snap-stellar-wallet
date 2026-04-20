import type {
  OnUserInputHandler,
  OnKeyringRequestHandler,
  OnRpcRequestHandler,
  OnCronjobHandler,
} from '@metamask/snaps-sdk';
import { MethodNotFoundError } from '@metamask/snaps-sdk';
import type { JsonRpcRequest } from '@metamask/utils';

import {
  keyringHandler,
  signMessageHandler,
  userInputHandler,
  signTransactionHandler,
  cronjobHandler,
} from './context';

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) => keyringHandler.handle(origin, request);

export const onUserInput: OnUserInputHandler = async (params) =>
  userInputHandler.handle(params);

export const onCronjob: OnCronjobHandler = async ({ request }) =>
  cronjobHandler.handle(request);

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  const { method } = request;

  switch (method) {
    case 'stellar_signMessage':
      return signMessageHandler.handle(
        request.params as unknown as JsonRpcRequest,
      );
    case 'stellar_signTransaction':
      return signTransactionHandler.handle(
        request.params as unknown as JsonRpcRequest,
      );
    default:
      throw new MethodNotFoundError() as Error;
  }
};
