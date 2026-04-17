import type { OnChainAccountLedgerMeta, SpendableBalance } from './api';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';

/** Plain snapshot of {@link OnChainAccount} fields and per-asset balances (e.g. for cache or RPC). */
export type OnChainAccountSerializable = {
  accountId: string;
  sequenceNumber: string;
  scope: KnownCaip2ChainId;
  meta: OnChainAccountLedgerMeta;
  balances: Record<KnownCaip19AssetIdOrSlip44Id, SpendableBalance>;
};
