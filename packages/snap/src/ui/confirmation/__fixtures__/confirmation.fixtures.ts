import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';

import { TransactionScanValidationType } from '../../../services/transaction-scan';

/** Default user preferences with every alert/scan toggle enabled. */
export const defaultPreferences: GetPreferencesResult = {
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

/** A successful scan result flagged as malicious. */
export const maliciousScan = {
  status: 'SUCCESS' as const,
  estimatedChanges: { assets: [] },
  validation: {
    type: TransactionScanValidationType.Malicious,
    reason: 'known_attacker',
    description: null,
  },
  error: null,
};

/**
 * Reads the JSX element `type` from a rendered confirmation component.
 *
 * @param component - The component returned by a confirmation render function.
 * @returns The element type, or `undefined` when nothing was rendered.
 */
export function getType(
  component: ComponentOrElement | null,
): string | undefined {
  return typeof component === 'object' && component !== null
    ? component.type
    : undefined;
}

/**
 * Reads the JSX `props` from a rendered confirmation component.
 *
 * @param component - The component returned by a confirmation render function.
 * @returns The element props, or `undefined` when nothing was rendered.
 */
export function getProps(
  component: ComponentOrElement | null,
): Record<string, unknown> | undefined {
  const candidate = component as { props?: Record<string, unknown> };
  return typeof component === 'object' && component !== null
    ? candidate.props
    : undefined;
}
