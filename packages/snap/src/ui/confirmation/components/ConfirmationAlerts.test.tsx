import { ConfirmationAlerts } from './ConfirmationAlerts';
import {
  defaultPreferences as preferences,
  getProps,
  getType,
  maliciousScan,
} from '../__fixtures__/confirmation.fixtures';
import { FetchStatus } from '../api';

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
