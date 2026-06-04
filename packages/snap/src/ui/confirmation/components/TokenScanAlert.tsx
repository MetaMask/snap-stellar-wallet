import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Banner, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import type { TokenScanResult } from '../../../services/transaction-scan';
import type { Locale } from '../../../utils';
import { i18n } from '../../../utils';
import type { ConfirmationBaseProps, FetchStatus } from '../api';
import { hasVisibleTokenScanAlert } from '../utils';

type TokenScanAlertProps = {
  preferences: ConfirmationBaseProps['preferences'];
  tokenScan: TokenScanResult | null;
  tokenScanFetchStatus: FetchStatus;
};

export const TokenScanAlert = ({
  preferences,
  tokenScan,
  tokenScanFetchStatus,
}: TokenScanAlertProps): ComponentOrElement | null => {
  if (
    !hasVisibleTokenScanAlert({
      preferences,
      tokenScan,
      tokenScanFetchStatus,
    }) ||
    tokenScan === null
  ) {
    return null;
  }

  const translate = i18n(preferences.locale as Locale);
  const asset =
    tokenScan.symbol ?? tokenScan.name ?? translate('confirmation.asset');

  return (
    <Banner
      title={translate(
        tokenScan.isMalicious
          ? 'confirmation.tokenScanMaliciousTitle'
          : 'confirmation.tokenScanWarningTitle',
      )}
      severity={tokenScan.isMalicious ? 'danger' : 'warning'}
    >
      <SnapText>
        {translate(
          tokenScan.isMalicious
            ? 'confirmation.tokenScanMaliciousSubtitle'
            : 'confirmation.tokenScanWarningSubtitle',
          { asset },
        )}
      </SnapText>
    </Banner>
  );
};
