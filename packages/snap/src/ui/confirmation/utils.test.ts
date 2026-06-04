import type { GetPreferencesResult } from '@metamask/snaps-sdk';

import { FetchStatus } from './api';
import {
  ConfirmationBanner,
  hasVisibleTokenScanAlert,
  isConfirmDisabledByScan,
  isConfirmDisabledByTokenScan,
  isConfirmDisabledByTransactionValidation,
  resolveConfirmationBanner,
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

const maliciousTokenScan = {
  resultType: TokenScanResultType.Malicious,
  isMalicious: true,
  isWarning: false,
  name: 'USD Coin',
  symbol: 'USDC',
};

const warningTokenScan = {
  resultType: TokenScanResultType.Warning,
  isMalicious: false,
  isWarning: true,
  name: 'USD Coin',
  symbol: 'USDC',
};

const benignTokenScan = {
  resultType: TokenScanResultType.Benign,
  isMalicious: false,
  isWarning: false,
  name: 'USD Coin',
  symbol: 'USDC',
};

const maliciousTransactionScan = {
  status: 'SUCCESS' as const,
  estimatedChanges: { assets: [] },
  validation: {
    type: TransactionScanValidationType.Malicious,
    reason: 'known_attacker',
    description: null,
  },
  error: null,
};

const benignTransactionScan = {
  status: 'SUCCESS' as const,
  estimatedChanges: { assets: [] },
  validation: {
    type: TransactionScanValidationType.Benign,
    reason: null,
    description: null,
  },
  error: null,
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

  describe('hasVisibleTokenScanAlert', () => {
    it.each([maliciousTokenScan, warningTokenScan])(
      'returns true for $resultType token scans',
      (tokenScan) => {
        expect(
          hasVisibleTokenScanAlert({
            preferences,
            tokenScan,
            tokenScanFetchStatus: FetchStatus.Fetched,
          }),
        ).toBe(true);
      },
    );

    it('returns false for benign token scans', () => {
      expect(
        hasVisibleTokenScanAlert({
          preferences,
          tokenScan: benignTokenScan,
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });

    it('returns true while token scan is fetching', () => {
      expect(
        hasVisibleTokenScanAlert({
          preferences,
          tokenScan: null,
          tokenScanFetchStatus: FetchStatus.Fetching,
        }),
      ).toBe(true);
    });

    it('returns false when Security Alerts are disabled', () => {
      expect(
        hasVisibleTokenScanAlert({
          preferences: {
            ...preferences,
            useSecurityAlerts: false,
          },
          tokenScan: maliciousTokenScan,
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(false);
    });
  });

  describe('resolveConfirmationBanner', () => {
    it('returns validation error when transaction validation fails despite visible scan alerts', () => {
      expect(
        resolveConfirmationBanner({
          preferences,
          transactionsFetchStatus: FetchStatus.Error,
          scan: maliciousTransactionScan,
          scanFetchStatus: FetchStatus.Fetched,
          tokenScan: maliciousTokenScan,
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.ValidationError);
    });

    it('returns transaction scan when transaction and token scan alerts are visible', () => {
      expect(
        resolveConfirmationBanner({
          preferences,
          transactionsFetchStatus: FetchStatus.Fetched,
          scan: maliciousTransactionScan,
          scanFetchStatus: FetchStatus.Fetched,
          tokenScan: maliciousTokenScan,
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.TransactionScan);
    });

    it.each([maliciousTokenScan, warningTokenScan])(
      'returns token scan for $resultType token-only alerts',
      (tokenScan) => {
        expect(
          resolveConfirmationBanner({
            preferences,
            transactionsFetchStatus: FetchStatus.Fetched,
            scan: benignTransactionScan,
            scanFetchStatus: FetchStatus.Fetched,
            tokenScan,
            tokenScanFetchStatus: FetchStatus.Fetched,
          }),
        ).toBe(ConfirmationBanner.TokenScan);
      },
    );

    it('returns token scan while token scan is fetching', () => {
      expect(
        resolveConfirmationBanner({
          preferences,
          transactionsFetchStatus: FetchStatus.Fetched,
          scan: benignTransactionScan,
          scanFetchStatus: FetchStatus.Fetched,
          tokenScan: null,
          tokenScanFetchStatus: FetchStatus.Fetching,
        }),
      ).toBe(ConfirmationBanner.TokenScan);
    });

    it('returns none when token args are omitted and nothing else is visible', () => {
      expect(
        resolveConfirmationBanner({
          preferences,
          transactionsFetchStatus: FetchStatus.Fetched,
          scan: benignTransactionScan,
          scanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.None);
    });

    it.each([
      {
        label: 'benign scan results',
        preferences,
        scan: benignTransactionScan,
        tokenScan: benignTokenScan,
      },
      {
        label: 'disabled preferences',
        preferences: {
          ...preferences,
          useSecurityAlerts: false,
          simulateOnChainActions: false,
        },
        scan: maliciousTransactionScan,
        tokenScan: maliciousTokenScan,
      },
    ])('returns none for $label', (params) => {
      expect(
        resolveConfirmationBanner({
          preferences: params.preferences,
          transactionsFetchStatus: FetchStatus.Fetched,
          scan: params.scan,
          scanFetchStatus: FetchStatus.Fetched,
          tokenScan: params.tokenScan,
          tokenScanFetchStatus: FetchStatus.Fetched,
        }),
      ).toBe(ConfirmationBanner.None);
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
