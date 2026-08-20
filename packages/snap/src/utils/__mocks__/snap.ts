import type { SnapsProvider } from '@metamask/snaps-sdk';

const actual = jest.requireActual('../snap');

(globalThis as typeof globalThis & { snap: { request: jest.Mock } }).snap = {
  request: jest.fn(),
};

export const getSnapProvider = (): SnapsProvider => snap;

export const getBip32Entropy = jest.fn();

export const listEntropySources = jest.fn();

export const getDefaultEntropySource = jest.fn();

export const trackEvent = jest.fn();

export const {
  getState,
  setState,
  updateState,
  createInterface,
  showDialog,
  getPreferences,
  resolveInterface,
  scheduleBackgroundEvent,
  Duration,
  TransactionEventType,
  SecurityEventType,
  trackTransactionAdded,
  trackTransactionRejected,
  trackTransactionApproved,
  trackTransactionSubmitted,
  trackTransactionFinalized,
  trackSecurityAlertDetected,
  trackSecurityScanCompleted,
  trackError,
} = actual;
