import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';

export class OnChainAccountException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnChainAccountException';
  }
}

export class OnChainAccountBalanceNotAvailableException extends OnChainAccountException {
  constructor(assetId: KnownCaip19AssetIdOrSlip44Id, accountId: string) {
    super(`Balance not available for asset ${assetId} on account ${accountId}`);
    this.name = 'OnChainAccountBalanceNotAvailableException';
  }
}
export class OnChainAccountMetadataNotAvailableException extends OnChainAccountException {
  constructor(accountId: string) {
    super(`Account metadata not available for account ${accountId}`);
    this.name = 'OnChainAccountMetadataNotAvailableException';
  }
}
