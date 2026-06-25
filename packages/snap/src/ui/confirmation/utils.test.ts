import {
  defaultPreferences as preferences,
  maliciousScan,
} from './__fixtures__/confirmation.fixtures';
import { FetchStatus } from './api';
import {
  ConfirmationBanner,
  isFetchInProgress,
  formatOrigin,
  isLocalTransactionValidationFailed,
  isRemoteTransactionScanLoading,
  requiresMaliciousAcknowledgement,
  resolveConfirmationBanner,
  shouldDisableConfirmation,
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
  describe('isFetchInProgress', () => {
    it.each([FetchStatus.Initial, FetchStatus.Fetching])(
      'returns true for %s',
      (status) => {
        expect(isFetchInProgress(status)).toBe(true);
      },
    );

    it.each([FetchStatus.Fetched, FetchStatus.Error])(
      'returns false for %s',
      (status) => {
        expect(isFetchInProgress(status)).toBe(false);
      },
    );
  });

  describe('formatOrigin', () => {
    it('returns "Unknown" for an undefined origin', () => {
      expect(formatOrigin(undefined)).toBe('Unknown');
    });

    it('returns "Unknown" for an empty origin', () => {
      expect(formatOrigin('')).toBe('Unknown');
    });

    it('returns "MetaMask" for the internal metamask origin', () => {
      expect(formatOrigin('metamask')).toBe('MetaMask');
    });

    it('returns "WalletConnect" for the wallet-connect origin', () => {
      expect(formatOrigin('wallet-connect')).toBe('WalletConnect');
    });

    it('matches known origins case-insensitively', () => {
      expect(formatOrigin('MetaMask')).toBe('MetaMask');
      expect(formatOrigin('Wallet-Connect')).toBe('WalletConnect');
    });

    it('returns the hostname for an http(s) URL', () => {
      expect(formatOrigin('https://example.com')).toBe('example.com');
      expect(formatOrigin('https://app.example.com/path?q=1')).toBe(
        'app.example.com',
      );
      expect(formatOrigin('http://example.com')).toBe('example.com');
    });

    it('returns an empty string for a non-URL string (e.g. a WalletConnect channelId)', () => {
      expect(formatOrigin('1234abcd-channel-id')).toBe('');
    });

    it('returns an empty string for a non-http URL', () => {
      expect(formatOrigin('ftp://example.com')).toBe('');
    });

    it('returns an empty string for an invalid value', () => {
      expect(formatOrigin('not a url')).toBe('');
    });
  });

  describe('isRemoteTransactionScanLoading', () => {
    it('disables confirm while scan is fetching', () => {
      expect(
        isRemoteTransactionScanLoading({
          scanFetchStatus: FetchStatus.Fetching,
        }),
      ).toBe(true);
    });

    it('does not disable confirm once the scan has fetched', () => {
      expect(
        isRemoteTransactionScanLoading({
          scanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('does not disable confirm when the scan fetch status is not fetching', () => {
      expect(
        isRemoteTransactionScanLoading({ scanFetchStatus: FetchStatus.Error }),
      ).toBe(false);
    });
  });

  describe('shouldDisableConfirmation', () => {
    it('blocks while the scan is fetching', () => {
      expect(
        shouldDisableConfirmation({ scanFetchStatus: FetchStatus.Fetching }),
      ).toBe(true);
    });

    it('blocks when re-validation reports an error', () => {
      expect(
        shouldDisableConfirmation({
          scanFetchStatus: FetchStatus.Fetched,
          transactionsFetchStatus: FetchStatus.Error,
        }),
      ).toBe(true);
    });

    it('does not block when scan is fetched and re-validation is clean', () => {
      expect(
        shouldDisableConfirmation({
          scanFetchStatus: FetchStatus.Fetched,
          transactionsFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('does not block when both statuses are omitted', () => {
      expect(shouldDisableConfirmation({})).toBe(false);
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

  describe('isLocalTransactionValidationFailed', () => {
    it('disables confirm when re-validation reports an error', () => {
      expect(isLocalTransactionValidationFailed(FetchStatus.Error)).toBe(true);
    });

    it('does not disable confirm while re-validation is fetching', () => {
      expect(isLocalTransactionValidationFailed(FetchStatus.Fetching)).toBe(
        false,
      );
    });

    it('does not disable confirm when re-validation has fetched', () => {
      expect(isLocalTransactionValidationFailed(FetchStatus.Fetched)).toBe(
        false,
      );
    });

    it('does not disable confirm when the status is undefined', () => {
      expect(isLocalTransactionValidationFailed(undefined)).toBe(false);
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
