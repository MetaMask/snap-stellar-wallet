import type { GetPreferencesResult } from '@metamask/snaps-sdk';

import { FetchStatus } from './api';
import { isConfirmDisabledByScan } from './utils';
import { TransactionScanValidationType } from '../../services/transaction-scan';

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
});
