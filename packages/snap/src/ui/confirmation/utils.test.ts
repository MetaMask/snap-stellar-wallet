import type { GetPreferencesResult } from '@metamask/snaps-sdk';

import { FetchStatus } from './api';
import {
  isConfirmDisabledByScan,
  isConfirmDisabledByTokenScan,
  isConfirmDisabledByTransactionValidation,
} from './utils';
import {
  TokenScanResultType,
  TransactionScanValidationType,
} from '../../services/transaction-scan';

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

  describe('isConfirmDisabledByTokenScan', () => {
    it('disables confirm while token scan is fetching', () => {
      expect(
        isConfirmDisabledByTokenScan({
          preferences,
          tokenScan: null,
          tokenScanFetchStatus: FetchStatus.Fetching,
        }),
      ).toBe(true);
    });

    it.each([
      {
        resultType: TokenScanResultType.Malicious,
        isMalicious: true,
        isWarning: false,
      },
      {
        resultType: TokenScanResultType.Warning,
        isMalicious: false,
        isWarning: true,
      },
    ])('disables confirm for $resultType token scans', (tokenScan) => {
      expect(
        isConfirmDisabledByTokenScan({
          preferences,
          tokenScan: {
            ...tokenScan,
            name: 'USD Coin',
            symbol: 'USDC',
          },
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(true);
    });

    it('does not disable confirm for benign token scans', () => {
      expect(
        isConfirmDisabledByTokenScan({
          preferences,
          tokenScan: {
            resultType: TokenScanResultType.Benign,
            isMalicious: false,
            isWarning: false,
            name: 'USD Coin',
            symbol: 'USDC',
          },
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('does not disable confirm when Security Alerts are disabled', () => {
      expect(
        isConfirmDisabledByTokenScan({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
          },
          tokenScan: {
            resultType: TokenScanResultType.Malicious,
            isMalicious: true,
            isWarning: false,
            name: 'USD Coin',
            symbol: 'USDC',
          },
          tokenScanFetchStatus: FetchStatus.Fetched,
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
});
