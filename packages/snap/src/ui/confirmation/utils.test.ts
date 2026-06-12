import {
  defaultPreferences as preferences,
  maliciousScan,
} from './__fixtures__/confirmation.fixtures';
import { FetchStatus } from './api';
import {
  ConfirmationBanner,
  isConfirmBlocked,
  isConfirmDisabledByScan,
  isConfirmDisabledByTransactionValidation,
  requiresMaliciousAcknowledgement,
  resolveConfirmationBanner,
} from './utils';
import { TransactionScanValidationType } from '../../services/transaction-scan';

const warningScan = {
  ...maliciousScan,
  validation: {
    type: TransactionScanValidationType.Warning,
    reason: 'suspicious_request',
    description: null,
  },
};

describe('confirmation utils', () => {
  describe('isConfirmDisabledByScan', () => {
    it('disables confirm while scan is fetching', () => {
      expect(
        isConfirmDisabledByScan({ scanFetchStatus: FetchStatus.Fetching }),
      ).toBe(true);
    });

    it('does not disable confirm once the scan has fetched', () => {
      expect(
        isConfirmDisabledByScan({ scanFetchStatus: FetchStatus.Fetched }),
      ).toBe(false);
    });

    it('does not disable confirm when the scan fetch status is not fetching', () => {
      expect(
        isConfirmDisabledByScan({ scanFetchStatus: FetchStatus.Error }),
      ).toBe(false);
    });
  });

  describe('isConfirmBlocked', () => {
    it('blocks while the scan is fetching', () => {
      expect(isConfirmBlocked({ scanFetchStatus: FetchStatus.Fetching })).toBe(
        true,
      );
    });

    it('blocks when re-validation reports an error', () => {
      expect(
        isConfirmBlocked({
          scanFetchStatus: FetchStatus.Fetched,
          transactionsFetchStatus: FetchStatus.Error,
        }),
      ).toBe(true);
    });

    it('does not block when scan is fetched and re-validation is clean', () => {
      expect(
        isConfirmBlocked({
          scanFetchStatus: FetchStatus.Fetched,
          transactionsFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('does not block when both statuses are omitted', () => {
      expect(isConfirmBlocked({})).toBe(false);
    });
  });

  describe('requiresMaliciousAcknowledgement', () => {
    it('requires acknowledgement for a malicious result when security alerts are enabled', () => {
      expect(
        requiresMaliciousAcknowledgement({ preferences, scan: maliciousScan }),
      ).toBe(true);
    });

    it('does not require acknowledgement when security alerts are disabled', () => {
      expect(
        requiresMaliciousAcknowledgement({
          preferences: { ...preferences, useSecurityAlerts: false },
          scan: maliciousScan,
        }),
      ).toBe(false);
    });

    it('does not require acknowledgement for warning-level results', () => {
      expect(
        requiresMaliciousAcknowledgement({ preferences, scan: warningScan }),
      ).toBe(false);
    });

    it('does not require acknowledgement when there is no scan result', () => {
      expect(
        requiresMaliciousAcknowledgement({ preferences, scan: null }),
      ).toBe(false);
    });
  });

  describe('isConfirmDisabledByTransactionValidation', () => {
    it('disables confirm when re-validation reports an error', () => {
      expect(isConfirmDisabledByTransactionValidation(FetchStatus.Error)).toBe(
        true,
      );
    });

    it('does not disable confirm while re-validation is fetching', () => {
      expect(
        isConfirmDisabledByTransactionValidation(FetchStatus.Fetching),
      ).toBe(false);
    });

    it('does not disable confirm when re-validation has fetched', () => {
      expect(
        isConfirmDisabledByTransactionValidation(FetchStatus.Fetched),
      ).toBe(false);
    });

    it('does not disable confirm when the status is undefined', () => {
      expect(isConfirmDisabledByTransactionValidation(undefined)).toBe(false);
    });
  });

  describe('resolveConfirmationBanner', () => {
    it('prioritizes the validation banner when re-validation reports an error', () => {
      expect(
        resolveConfirmationBanner({
          preferences,
          transactionsFetchStatus: FetchStatus.Error,
        }),
      ).toBe(ConfirmationBanner.TransactionValidation);
    });

    it('prioritizes the validation banner even when scan is enabled', () => {
      expect(
        resolveConfirmationBanner({
          preferences: {
            ...preferences,
            useSecurityAlerts: true,
            simulateOnChainActions: true,
          },
          transactionsFetchStatus: FetchStatus.Error,
        }),
      ).toBe(ConfirmationBanner.TransactionValidation);
    });

    it('shows the scan banner when security alerts are enabled and there is no validation error', () => {
      expect(
        resolveConfirmationBanner({
          preferences: {
            ...preferences,
            useSecurityAlerts: true,
            simulateOnChainActions: false,
          },
          transactionsFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.TransactionScan);
    });

    it('shows the scan banner when simulation alerts are enabled', () => {
      expect(
        resolveConfirmationBanner({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
          transactionsFetchStatus: FetchStatus.Initial,
        }),
      ).toBe(ConfirmationBanner.TransactionScan);
    });

    it('shows no banner when scan is disabled and there is no validation error', () => {
      expect(
        resolveConfirmationBanner({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
            simulateOnChainActions: false,
          },
          transactionsFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.None);
    });

    it('treats an undefined validation status as no validation error', () => {
      expect(
        resolveConfirmationBanner({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
            simulateOnChainActions: false,
          },
          transactionsFetchStatus: undefined,
        }),
      ).toBe(ConfirmationBanner.None);
    });
  });
});
