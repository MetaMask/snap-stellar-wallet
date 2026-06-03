import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';

import { TokenScanResultType } from '../../../services/transaction-scan';
import { FetchStatus } from '../api';
import { TokenScanAlert } from './TokenScanAlert';

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

describe('TokenScanAlert', () => {
  it('renders malicious token scans as danger banners', () => {
    const component = TokenScanAlert({
      preferences,
      tokenScanFetchStatus: FetchStatus.Fetched,
      tokenScan: {
        resultType: TokenScanResultType.Malicious,
        isMalicious: true,
        isWarning: false,
        name: 'USD Coin',
        symbol: 'USDC',
      },
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'danger',
      title: 'This asset may be malicious',
    });
  });

  it('renders warning token scans as warning banners', () => {
    const component = TokenScanAlert({
      preferences,
      tokenScanFetchStatus: FetchStatus.Fetched,
      tokenScan: {
        resultType: TokenScanResultType.Warning,
        isMalicious: false,
        isWarning: true,
        name: null,
        symbol: 'USDC',
      },
    });

    expect(getType(component)).toBe('Banner');
    expect(getProps(component)).toMatchObject({
      severity: 'warning',
      title: 'This asset may be risky',
    });
  });

  it.each([
    TokenScanResultType.Benign,
    TokenScanResultType.Verified,
    TokenScanResultType.Trusted,
  ])('renders nothing for %s token scans', (resultType) => {
    const component = TokenScanAlert({
      preferences,
      tokenScanFetchStatus: FetchStatus.Fetched,
      tokenScan: {
        resultType,
        isMalicious: false,
        isWarning: false,
        name: 'USD Coin',
        symbol: 'USDC',
      },
    });

    expect(component).toBeNull();
  });

  it('renders nothing when Security Alerts are disabled', () => {
    const component = TokenScanAlert({
      preferences: {
        ...preferences,
        useSecurityAlerts: false,
      },
      tokenScanFetchStatus: FetchStatus.Fetched,
      tokenScan: {
        resultType: TokenScanResultType.Malicious,
        isMalicious: true,
        isWarning: false,
        name: 'USD Coin',
        symbol: 'USDC',
      },
    });

    expect(component).toBeNull();
  });

  it('renders nothing while fetching', () => {
    const component = TokenScanAlert({
      preferences,
      tokenScanFetchStatus: FetchStatus.Fetching,
      tokenScan: null,
    });

    expect(component).toBeNull();
  });
});
