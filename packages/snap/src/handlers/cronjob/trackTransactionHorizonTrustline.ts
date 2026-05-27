import type { KnownCaip19ClassicAssetId } from '../../api';
import type { OnChainAccount } from '../../services/on-chain-account';

/**
 * Expected trustline outcome after a {@link ClientRequestMethod.ChangeTrustOpt} transaction.
 */
export enum TrackTransactionTrustlineAction {
  Add = 'add',
  Delete = 'delete',
}

export type TrackTransactionTrustlineVerification = {
  assetId: KnownCaip19ClassicAssetId;
  action: TrackTransactionTrustlineAction;
};

/**
 * Returns whether a fresh Horizon account load reflects the expected trustline change.
 *
 * @param onChainAccount - Account loaded from Horizon (not persisted snap snapshot).
 * @param assetId - Classic CAIP-19 asset id for the trustline.
 * @param action - Opt-in expects limit greater than 0; opt-out expects line absent or limit 0.
 * @returns `true` when Horizon matches the expected post-tx trustline state.
 */
export function isHorizonTrustlineMatchingExpectation(
  onChainAccount: OnChainAccount,
  assetId: KnownCaip19ClassicAssetId,
  action: TrackTransactionTrustlineAction,
): boolean {
  if (action === TrackTransactionTrustlineAction.Delete) {
    if (!onChainAccount.hasAsset(assetId)) {
      return true;
    }
    const row = onChainAccount.getAsset(assetId);
    return row?.limit?.isZero() ?? false;
  }

  const row = onChainAccount.getAsset(assetId);
  return row?.limit?.gt(0) ?? false;
}

/**
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves after `ms`.
 */
export async function delayMilliseconds(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
