import type { ComponentOrElement } from '@metamask/snaps-sdk';

import { TransactionAlert } from './TransactionAlert';
import { TransactionValidationAlert } from './TransactionValidationAlert';
import type { ConfirmationBaseProps, FetchStatus } from '../api';
import { ConfirmationBanner, resolveConfirmationBanner } from '../utils';

type ConfirmationAlertsProps = {
  preferences: ConfirmationBaseProps['preferences'];
  scan: ConfirmationBaseProps['scan'];
  scanFetchStatus: FetchStatus;
  transactionsFetchStatus: FetchStatus;
};

/**
 * Renders the single top-of-screen confirmation banner.
 *
 * Centralizes the validation-error vs. Blockaid-scan priority (see
 * {@link resolveConfirmationBanner}) so the views never stack both banners and
 * the rule lives in one place.
 *
 * @param props - The confirmation alert state.
 * @param props.preferences - User preferences controlling scan behavior.
 * @param props.scan - Latest transaction scan result.
 * @param props.scanFetchStatus - Latest transaction scan fetch status.
 * @param props.transactionsFetchStatus - Latest transaction re-validation fetch status.
 * @returns The banner to render, or `null` when none applies.
 */
export const ConfirmationAlerts = ({
  preferences,
  scan,
  scanFetchStatus,
  transactionsFetchStatus,
}: ConfirmationAlertsProps): ComponentOrElement | null => {
  switch (resolveConfirmationBanner({ preferences, transactionsFetchStatus })) {
    case ConfirmationBanner.TransactionValidation:
      return (
        <TransactionValidationAlert
          preferences={preferences}
          transactionsFetchStatus={transactionsFetchStatus}
        />
      );
    case ConfirmationBanner.TransactionScan:
      return (
        <TransactionAlert
          scanFetchStatus={scanFetchStatus}
          validation={scan?.validation ?? null}
          error={scan?.error ?? null}
          preferences={preferences}
        />
      );
    case ConfirmationBanner.None:
    default:
      return null;
  }
};
