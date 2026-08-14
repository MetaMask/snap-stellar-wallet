import type { DialogResult } from '@metamask/snaps-sdk';

import { createInterface, showDialog } from '../../../../utils';
import { getLocale } from '../../utils';
import { AccountActivationPrompt } from './AccountActivationPrompt';

/**
 * Renders the account activation prompt.
 *
 * @param accountAddress - The account address.
 * @returns The account activation prompt dialog result.
 */
export async function render(accountAddress: string): Promise<DialogResult> {
  const locale = await getLocale();

  const id = await createInterface(
    <AccountActivationPrompt accountAddress={accountAddress} locale={locale} />,
    {},
  );

  const dialogPromise = showDialog(id, 'alert');

  return dialogPromise;
}
