import type { SnapsProvider } from '@metamask/snaps-sdk';

const actual = jest.requireActual('../snap');

(globalThis as any).snap = {
  request: jest.fn(),
} as unknown as SnapsProvider;

export const getSnapProvider = (): SnapsProvider => snap;

export const getBip32Entropy = jest.fn();

export const listEntropySources = jest.fn();

export const getDefaultEntropySource = jest.fn();

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
} = actual;
