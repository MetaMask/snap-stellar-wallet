import { defaultPreferences as preferences } from './__fixtures__/confirmation.fixtures';
import { FetchStatus } from './api';
import {
  ConfirmationBanner,
  isConfirmDisabledByScan,
  isConfirmDisabledByTransactionValidation,
  resolveConfirmationBanner,
} from './utils';
import { TransactionScanValidationType } from '../../services/transaction-scan';

describe('confirmation utils', () => {
  describe('isConfirmDisabledByScan', () => {
    it('disables confirm while scan is fetching', () => {
      expect(
        isConfirmDisabledByScan({
          preferences,
          scan: null,
          scanFetchStatus: FetchStatus.Fetching,
        }),
      ).toBe(true);
    });

    it('disables confirm for malicious validation alerts', () => {
      expect(
        isConfirmDisabledByScan({
          preferences,
          scan: {
            status: 'SUCCESS',
            estimatedChanges: { assets: [] },
            validation: {
              type: TransactionScanValidationType.Malicious,
              reason: 'known_attacker',
              description: null,
            },
            error: null,
          },
          scanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(true);
    });

    it('does not disable confirm for simulation errors', () => {
      expect(
        isConfirmDisabledByScan({
          preferences,
          scan: {
            status: 'ERROR',
            estimatedChanges: { assets: [] },
            validation: null,
            error: {
              type: 'simulation',
              code: 'insufficient_balance',
              message: 'insufficient_balance',
            },
          },
          scanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('does not disable confirm for malicious validation when security alerts are disabled', () => {
      expect(
        isConfirmDisabledByScan({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
          },
          scan: {
            status: 'SUCCESS',
            estimatedChanges: { assets: [] },
            validation: {
              type: TransactionScanValidationType.Malicious,
              reason: 'known_attacker',
              description: null,
            },
            error: null,
          },
          scanFetchStatus: FetchStatus.Fetched,
        }),
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
