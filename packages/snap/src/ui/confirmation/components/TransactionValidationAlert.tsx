import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Banner, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import { i18n } from '../../../utils';
import type { ConfirmationBaseProps } from '../api';
import { FetchStatus } from '../api';

type TransactionValidationAlertProps = {
  preferences: ConfirmationBaseProps['preferences'];
  transactionsFetchStatus: FetchStatus;
};

// Danger banner shown when background re-validation finds the pending transaction
// is no longer valid (expired, sequence changed, or insufficient balance).
export const TransactionValidationAlert = ({
  preferences,
  transactionsFetchStatus,
}: TransactionValidationAlertProps): ComponentOrElement | null => {
  if (transactionsFetchStatus !== FetchStatus.Error) {
    return null;
  }

  const translate = i18n(preferences.locale);

  return (
    <Banner
      title={translate('confirmation.transactionInvalidTitle')}
      severity="danger"
    >
      <SnapText>
        {translate('confirmation.transactionInvalidSubtitle')}
      </SnapText>
    </Banner>
  );
};
