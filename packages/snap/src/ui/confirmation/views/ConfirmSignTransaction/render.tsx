import type { DialogResult } from '@metamask/snaps-sdk';

import { ConfirmSignTransction } from './ConfirmSignTransaction';
import type { SignTransactionRequest } from '../../../../handlers/keyring';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { Transaction } from '../../../../services/transaction';
import { createInterface, showDialog } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import { formatOrigin, getLocale } from '../../utils';

/**
 * Renders the confirmation dialog for a sign transaction request.
 *
 * @param request - The keyring request to confirm.
 * @param transaction - The transaction to show in the confirmation UI.
 * @param account - The account that the request is for.
 * @returns The confirmation dialog result.
 */
export async function render(
  request: SignTransactionRequest,
  transaction: Transaction,
  account: StellarKeyringAccount,
): Promise<DialogResult> {
  const { scope, origin } = request;

  const locale = await getLocale();

  const id = await createInterface(
    <ConfirmSignTransction
      transaction={transaction}
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
