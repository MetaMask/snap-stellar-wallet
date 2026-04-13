import type { DialogResult } from '@metamask/snaps-sdk';

import { ConfirmSignMessage } from './ConfirmSignMessage';
import type { SignMessageRequest } from '../../../../handlers/keyring';
import type { StellarKeyringAccount } from '../../../../services/account';
import {
  bufferToUint8Array,
  createInterface,
  showDialog,
} from '../../../../utils';
import { isBase64 } from '../../../../utils/string';
import { STELLAR_IMAGE } from '../../../images/icon';
import { formatOrigin, getLocale } from '../../utils';

/**
 * Decodes a message to UTF-8.
 *
 * @param message - The message to decode.
 * @returns The decoded message.
 */
function getUtf8Message(message: string): string {
  if (isBase64(message)) {
    return bufferToUint8Array(message, 'base64').toString('utf8');
  }
  return message;
}

/**
 * Renders the confirmation dialog for a sign message request.
 *
 * @param request - The keyring request to confirm.
 * @param account - The account that the request is for.
 * @returns The confirmation dialog result.
 */
export async function render(
  request: SignMessageRequest,
  account: StellarKeyringAccount,
): Promise<DialogResult> {
  const {
    request: {
      params: { message },
    },
    scope,
    origin,
  } = request;

  const locale = await getLocale();

  const id = await createInterface(
    <ConfirmSignMessage
      message={getUtf8Message(message)}
      account={account}
      scope={scope}
      locale={locale}
      networkImage={STELLAR_IMAGE}
      origin={formatOrigin(origin)}
    />,
    {},
  );

  const dialogPromise = showDialog(id);

  return dialogPromise;
}
