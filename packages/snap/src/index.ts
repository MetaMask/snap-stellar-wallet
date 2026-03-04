import type { OnKeyringRequestHandler } from '@metamask/snaps-sdk';

import { keyringHandler } from './context';
import { withCatchAndThrowSnapError } from './utils';

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) =>
  withCatchAndThrowSnapError(async () =>
    keyringHandler.handle(origin, request),
  );
