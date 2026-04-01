import type {
  OnClientRequestHandler,
  OnKeyringRequestHandler,
} from '@metamask/snaps-sdk';

import { keyringHandler, clientRequestHandler } from './context';

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) => keyringHandler.handle(origin, request);

export const onClientRequest: OnClientRequestHandler = async ({ request }) =>
  clientRequestHandler.handle(request);
