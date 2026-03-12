import type { OnKeyringRequestHandler } from '@metamask/snaps-sdk';

import { keyringHandler } from './context';

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) => keyringHandler.handle(origin, request);
