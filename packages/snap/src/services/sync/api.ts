import type { KnownCaip2ChainId } from '../../api/network';
import type { StellarKeyringAccount } from '../account';
import type { OnChainAccount } from '../on-chain-account';

export type ActivatedAccountPair = {
  keyringAccount: StellarKeyringAccount;
  onChainAccount: OnChainAccount;
};

export type SynchronizeOptions = {
  syncAccounts?: boolean;
  syncTransactions?: boolean;
  scope?: KnownCaip2ChainId;
};
