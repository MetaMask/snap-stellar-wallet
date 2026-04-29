import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import type { KnownCaip2ChainId } from '../../api';

/** Per-asset view: native, classic trustline (limit + issuer in `address`), or SEP-41. */
export type SpendableBalance = {
  balance: BigNumber;
  symbol: string;
  limit?: BigNumber;
  address?: string;
  authorized?: boolean;
  sponsored?: boolean;
};

type KeyringAccountId = string;

/** `onChainAccounts[keyringAccountId][scope]` → last synced snapshot. */
export type OnChainAccountSnapshotsByKeyringId = Record<
  KeyringAccountId,
  Partial<Record<KnownCaip2ChainId, OnChainAccountSerializableFull>>
>;

/**
 * Snap state slice for cached on-chain account snapshots (persisted under `onChainAccounts`).
 */
export type OnChainAccountState = {
  onChainAccounts: OnChainAccountSnapshotsByKeyringId;
};
