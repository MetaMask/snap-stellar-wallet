import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Banner,
  Icon,
  Link,
  Text as SnapText,
  type BannerProps,
} from '@metamask/snaps-sdk/jsx';

import type {
  TransactionScanError,
  TransactionScanValidation,
} from '../../../services/transaction-scan';
import { TransactionScanValidationType } from '../../../services/transaction-scan';
import type { Locale, LocalizedMessage } from '../../../utils';
import { i18n } from '../../../utils';
import type { ConfirmationBaseProps } from '../api';
import { FetchStatus } from '../api';

type TransactionAlertProps = {
  preferences: ConfirmationBaseProps['preferences'];
  validation: TransactionScanValidation | null;
  error: TransactionScanError | null;
  scanFetchStatus: FetchStatus;
};

const VALIDATION_TYPE_TO_ALERT: Partial<
  Record<
    NonNullable<TransactionScanValidation['type']>,
    {
      severity: BannerProps['severity'];
      title: LocalizedMessage;
      subtitle: LocalizedMessage;
    }
  >
> = {
  [TransactionScanValidationType.Malicious]: {
    severity: 'danger',
    title: 'confirmation.validationErrorTitle',
    subtitle: 'confirmation.validationErrorSubtitle',
  },
  [TransactionScanValidationType.Warning]: {
    severity: 'warning',
    title: 'confirmation.validationWarningTitle',
    subtitle: 'confirmation.validationWarningSubtitle',
  },
};

const ERROR_MESSAGE_IDS: Record<string, LocalizedMessage> = {
  insufficientbalance: 'transactionScan.errors.insufficientBalance',
  insufficientfunds: 'transactionScan.errors.insufficientFunds',
  invalidtransaction: 'transactionScan.errors.invalidTransaction',
  invalidaddress: 'transactionScan.errors.invalidAddress',
  unsupportedeip712message: 'transactionScan.errors.unsupportedEIP712Message',
};

const DEFAULT_ERROR_ALERT = {
  severity: 'warning',
  title: 'confirmation.securityScanErrorTitle',
  subtitle: 'confirmation.securityScanErrorSubtitle',
} as const satisfies {
  severity: BannerProps['severity'];
  title: LocalizedMessage;
  subtitle: LocalizedMessage;
};

const ERROR_TYPE_TO_ALERT: Record<
  string,
  {
    severity: BannerProps['severity'];
    title: LocalizedMessage;
    subtitle: LocalizedMessage;
  }
> = {
  simulation: {
    severity: 'warning',
    title: 'confirmation.simulationErrorTitle',
    subtitle: 'confirmation.simulationErrorSubtitle',
  },
  validation: {
    severity: 'warning',
    title: 'confirmation.validationScanErrorTitle',
    subtitle: 'confirmation.validationScanErrorSubtitle',
  },
  response: {
    severity: 'warning',
    title: 'confirmation.securityScanIncompleteTitle',
    subtitle: 'confirmation.securityScanIncompleteSubtitle',
  },
};

export const TransactionAlert = ({
  preferences,
  validation,
  error,
  scanFetchStatus,
}: TransactionAlertProps): ComponentOrElement | null => {
  const translate = i18n(preferences.locale as Locale);

  if (scanFetchStatus === FetchStatus.Fetching) {
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

  if (scanFetchStatus === FetchStatus.Error) {
    return (
      <Banner
        title={translate('confirmation.securityScanAPIErrorTitle')}
        severity="danger"
      >
        <SnapText>
          {translate('confirmation.securityScanAPIErrorMessage')}
        </SnapText>
      </Banner>
    );
  }

  // Match the extension confirmation pattern: show scan failures before severity findings.
  if (error && shouldShowError(error, preferences)) {
    const alert = getErrorAlert(error);

    return (
      <Banner title={translate(alert.title)} severity={alert.severity}>
        <SnapText>
          {translate(alert.subtitle, {
            reason: getErrorMessage(error, preferences.locale),
          })}
        </SnapText>
      </Banner>
    );
  }

  if (validation?.type && preferences.useSecurityAlerts) {
    const alert = VALIDATION_TYPE_TO_ALERT[validation.type];

    if (alert) {
      const description = validation.description?.trim();
      const subtitle =
        description === undefined || description.length === 0
          ? translate(alert.subtitle)
          : description;

      return (
        <Banner title={translate(alert.title)} severity={alert.severity}>
          <SnapText>{subtitle}</SnapText>
          <SnapText size="sm">
            <Link href="https://support.metamask.io/configure/wallet/how-to-turn-on-security-alerts/">
              {translate('confirmation.validationErrorLearnMore')}
            </Link>
          </SnapText>
          <SnapText size="sm">
            <Icon color="primary" name="security-tick" />{' '}
            {translate('confirmation.validationErrorSecurityAdviced')}{' '}
            <Link href="https://www.blockaid.io">Blockaid</Link>
          </SnapText>
        </Banner>
      );
    }

    // Benign validation results intentionally render no banner.
  }

  return null;
};

/**
 * Determines whether a scan error should be visible for the enabled alert type.
 *
 * @param error - The scan error to evaluate.
 * @param preferences - User preferences controlling scan behavior.
 * @returns True when the error should be rendered.
 */
function shouldShowError(
  error: TransactionScanError,
  preferences: ConfirmationBaseProps['preferences'],
): boolean {
  if (error.type === 'simulation') {
    return preferences.simulateOnChainActions;
  }

  if (error.type === 'validation') {
    return preferences.useSecurityAlerts;
  }

  return preferences.simulateOnChainActions || preferences.useSecurityAlerts;
}

/**
 * Gets the alert copy for a scan error type.
 *
 * @param error - The scan error returned by the transaction scan service.
 * @returns Localized title/subtitle identifiers and banner severity.
 */
function getErrorAlert(error: TransactionScanError): {
  severity: BannerProps['severity'];
  title: LocalizedMessage;
  subtitle: LocalizedMessage;
} {
  if (error.type) {
    return ERROR_TYPE_TO_ALERT[error.type] ?? DEFAULT_ERROR_ALERT;
  }

  return DEFAULT_ERROR_ALERT;
}

/**
 * Gets a user-facing scan error message.
 *
 * @param error - The scan error returned by the transaction scan service.
 * @param locale - The locale used for translated fallback messages.
 * @returns A translated or API-provided error message.
 */
function getErrorMessage(error: TransactionScanError, locale: string): string {
  const translate = i18n(locale);
  const normalizedCode = error.code
    ?.replace(/[^a-zA-Z0-9]/gu, '')
    .toLowerCase();
  const messageId = normalizedCode ? ERROR_MESSAGE_IDS[normalizedCode] : null;

  if (messageId) {
    return translate(messageId);
  }

  return (
    error.message ??
    translate('transactionScan.errors.unknownError' as LocalizedMessage)
  );
}
