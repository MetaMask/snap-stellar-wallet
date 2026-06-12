import { TransactionAlert } from './TransactionAlert';
import { TransactionScanValidationType } from '../../../services/transaction-scan';
import {
  defaultPreferences as preferences,
  getProps,
  getType,
} from '../__fixtures__/confirmation.fixtures';
import { FetchStatus } from '../api';

describe('TransactionAlert', () => {
  it('renders a scan-in-progress banner while fetching', () => {
    const component = TransactionAlert({
      preferences,
      validation: null,
      error: null,
      scanFetchStatus: FetchStatus.Fetching,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'info',
      title: 'Checking for security issues',
    });
  });

  it('renders simulation errors when only simulation alerts are enabled', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        useSecurityAlerts: false,
      },
      validation: null,
      error: {
        type: 'simulation',
        code: 'insufficient_balance',
        message: 'insufficient_balance',
      },
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'This transaction was reverted during simulation.',
    });
  });

  it('renders validation scan errors with validation failure copy', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        simulateOnChainActions: false,
      },
      validation: null,
      error: {
        type: 'validation',
        code: 'invalid_transaction',
        message: 'invalid_transaction',
      },
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'Security validation failed',
    });
  });

  it('renders response scan errors with incomplete scan copy', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        simulateOnChainActions: false,
      },
      validation: null,
      error: {
        type: 'response',
        code: 'empty',
        message: 'No scan results returned',
      },
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'Security scan incomplete',
    });
  });

  it('does not render validation alerts when security alerts are disabled', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        useSecurityAlerts: false,
      },
      validation: {
        type: TransactionScanValidationType.Malicious,
        reason: 'known_attacker',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(component).toBeNull();
  });

  it('renders malicious validation alerts as danger banners', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        simulateOnChainActions: false,
      },
      validation: {
        type: TransactionScanValidationType.Malicious,
        reason: 'known_attacker',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'danger',
      title: 'This is a deceptive request',
    });
  });

  it('renders warning validation alerts with softer warning copy', () => {
    const component = TransactionAlert({
      preferences: {
        ...preferences,
        simulateOnChainActions: false,
      },
      validation: {
        type: TransactionScanValidationType.Warning,
        reason: 'suspicious_request',
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
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
        type: TransactionScanValidationType.Benign,
        reason: null,
        description: null,
      },
      error: null,
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(component).toBeNull();
  });

  it('renders scan errors before validation severity findings', () => {
    const component = TransactionAlert({
      preferences,
      validation: {
        type: TransactionScanValidationType.Malicious,
        reason: 'known_attacker',
        description: null,
      },
      error: {
        type: 'simulation',
        code: 'invalid_transaction',
        message: 'invalid_transaction',
      },
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'This transaction was reverted during simulation.',
    });
  });
});
