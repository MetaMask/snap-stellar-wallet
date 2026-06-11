import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';

import { ConfirmationAlerts } from './ConfirmationAlerts';
import { TransactionScanValidationType } from '../../../services/transaction-scan';
import { FetchStatus } from '../api';

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

function getType(component: ComponentOrElement | null): string | undefined {
  return typeof component === 'object' && component !== null
    ? component.type
    : undefined;
}

function getProps(
  component: ComponentOrElement | null,
): Record<string, unknown> | undefined {
  const candidate = component as { props?: Record<string, unknown> };
  return typeof component === 'object' && component !== null
    ? candidate.props
    : undefined;
}

describe('ConfirmationAlerts', () => {
  it('renders the validation banner when re-validation reports an error', () => {
    const component = ConfirmationAlerts({
      preferences,
      scan: null,
      scanFetchStatus: FetchStatus.Fetched,
      transactionsFetchStatus: FetchStatus.Error,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'danger',
      title: 'Transaction is no longer valid',
    });
  });

  it('renders the scan banner when scan is enabled and there is no validation error', () => {
    const component = ConfirmationAlerts({
      preferences,
      scan: maliciousScan,
      scanFetchStatus: FetchStatus.Fetched,
      transactionsFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      title: 'This is a deceptive request',
    });
  });

  it('renders nothing when scan is disabled and there is no validation error', () => {
    const component = ConfirmationAlerts({
      preferences: {
        ...preferences,
        useSecurityAlerts: false,
        simulateOnChainActions: false,
      },
      scan: null,
      scanFetchStatus: FetchStatus.Fetched,
      transactionsFetchStatus: FetchStatus.Fetched,
    });

    expect(component).toBeNull();
  });

  it('shows the validation banner (not the scan banner) when both would apply', () => {
    const component = ConfirmationAlerts({
      preferences,
      scan: maliciousScan,
      scanFetchStatus: FetchStatus.Fetched,
      transactionsFetchStatus: FetchStatus.Error,
    });

    expect(getProps(component)).toMatchObject({
      title: 'Transaction is no longer valid',
    });
  });
});
