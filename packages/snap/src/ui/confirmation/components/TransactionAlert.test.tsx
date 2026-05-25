import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';

import { FetchStatus } from '../api';
import { TransactionAlert } from './TransactionAlert';

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

function getType(component: ComponentOrElement): string | undefined {
  return typeof component === 'object' && component !== null
    ? component.type
    : undefined;
}

function getProps(
  component: ComponentOrElement,
): Record<string, unknown> | undefined {
  const candidate = component as { props?: Record<string, unknown> };
  return typeof component === 'object' && component !== null
    ? candidate.props
    : undefined;
}

describe('TransactionAlert', () => {
  it('renders a scan-in-progress banner while fetching', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: null,
      scanFetchStatus: FetchStatus.Fetching,
      showValidationAlert: true,
      showSimulationError: true,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'info',
      title: 'Checking for security issues',
    });
  });

  it('renders simulation errors when only simulation alerts are enabled', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: {
        type: 'simulation',
        code: 'insufficient_balance',
        message: 'insufficient_balance',
      },
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: false,
      showSimulationError: true,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'This transaction was reverted during simulation.',
    });
  });

  it('renders validation scan errors with validation failure copy', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: {
        type: 'validation',
        code: 'invalid_transaction',
        message: 'invalid_transaction',
      },
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: true,
      showSimulationError: false,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'Security validation failed',
    });
  });

  it('renders response scan errors with incomplete scan copy', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: {
        type: 'response',
        code: 'empty',
        message: 'No scan results returned',
      },
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: true,
      showSimulationError: false,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'Security scan incomplete',
    });
  });

  it('does not render validation alerts when security alerts are disabled', () => {
    const component = TransactionAlert({
      preferences,
      validation: {
        type: 'Malicious',
        reason: 'known_attacker',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: false,
      showSimulationError: true,
    });

    expect(getType(component)).toBe('Box');
  });

  it('renders malicious validation alerts as danger banners', () => {
    const component = TransactionAlert({
      preferences,
      validation: {
        type: 'Malicious',
        reason: 'known_attacker',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: true,
      showSimulationError: false,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'danger',
      title: 'This is a deceptive request',
    });
  });

  it('renders warning validation alerts with softer warning copy', () => {
    const component = TransactionAlert({
      preferences,
      validation: {
        type: 'Warning',
        reason: 'suspicious_request',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: true,
      showSimulationError: false,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'This request may be risky',
    });
  });

  it('renders API scan failures as danger banners', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: null,
      scanFetchStatus: FetchStatus.Error,
      showValidationAlert: false,
      showSimulationError: true,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'danger',
      title: 'Security scan failed',
    });
  });

  it('renders nothing for benign validation', () => {
    const component = TransactionAlert({
      preferences,
      validation: {
        type: 'Benign',
        reason: null,
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
      showValidationAlert: true,
      showSimulationError: true,
    });

    expect(getType(component)).toBe('Box');
  });
});
