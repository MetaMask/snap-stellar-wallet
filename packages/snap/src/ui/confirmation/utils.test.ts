import type { GetPreferencesResult } from '@metamask/snaps-sdk';

import { FetchStatus } from './api';
import {
  isConfirmDisabledByScan,
  isConfirmDisabledByTransactionValidation,
  requiresMaliciousAcknowledgement,
} from './utils';
import { TransactionScanValidationType } from '../../services/transaction-scan';

const maliciousScan = {
  status: 'SUCCESS' as const,
  estimatedChanges: { assets: [] },
  validation: {
    type: TransactionScanValidationType.Malicious,
    reason: 'known_attacker',
    description: null,
  },
  error: null,
};

const warningScan = {
  ...maliciousScan,
  validation: {
    type: TransactionScanValidationType.Warning,
    reason: 'suspicious_request',
    description: null,
  },
};

const preferences: GetPreferencesResult = {
  locale: 'en',
  currency: 'usd',
  hideBalances: false,
  useSecurityAlerts: true,
  simulateOnChainActions: true,
  useTokenDetection: true,
  batchCheckBalances: true,
  displayNftMedia: true,
  useNftDetection: true,
  useExternalPricingData: true,
  showTestnets: true,
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
});
