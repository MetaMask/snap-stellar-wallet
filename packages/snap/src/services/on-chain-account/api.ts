import type { KnownCaip2ChainId } from '../../api';

/**
 * Persisted on-chain account header fields for one keyring account on one network, refreshed on sync.
 * Does not include trustline balances (see `accountBalances` state).
 */
export type OnChainAccountSnapshot = {
  accountId: string;
  sequenceNumber: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  /** Unix ms when this row was written to snap state. */
  persistedAt?: number;
};

/** `accountMetadata[keyringAccountId][scope]` → last synced {@link OnChainAccountSnapshot}. */
export type OnChainAccountSnapshotsByKeyringId = Record<
  string,
  Partial<Record<KnownCaip2ChainId, OnChainAccountSnapshot>>
>;

/**
 * Snap state slice for cached on-chain account snapshots.
 * The root key stays `accountMetadata` for persisted snap state compatibility.
 */
export type OnChainAccountSnapshotState = {
  accountMetadata: OnChainAccountSnapshotsByKeyringId;
};
