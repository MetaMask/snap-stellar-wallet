import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Banner, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import type { TokenScanResult } from '../../../services/transaction-scan';
import type { Locale } from '../../../utils';
import { i18n } from '../../../utils';
import type { ConfirmationBaseProps } from '../api';
import { FetchStatus } from '../api';
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
    (tokenScanFetchStatus === FetchStatus.Fetched && tokenScan === null)
  ) {
    return null;
  }

  const translate = i18n(preferences.locale as Locale);

  if (tokenScanFetchStatus === FetchStatus.Fetching) {
    return (
      <Banner
        title={translate('confirmation.securityScanInProgressTitle')}
        severity="info"
      >
        <SnapText>
          {translate('confirmation.securityScanInProgressMessage')}
        </SnapText>
      </Banner>
    );
  }

  if (tokenScan === null) {
    return null;
  }

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
