import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { StellarSnapException } from '../../utils';

export class OnChainAccountException extends StellarSnapException {}

export class OnChainAccountBalanceNotAvailableException extends OnChainAccountException {
  constructor(assetId: KnownCaip19AssetIdOrSlip44Id) {
    super(`Balance not available for asset ${assetId}`);
  }
}
export class OnChainAccountMetadataNotAvailableException extends OnChainAccountException {
  constructor() {
    super(`Account metadata not available`);
  }
}
