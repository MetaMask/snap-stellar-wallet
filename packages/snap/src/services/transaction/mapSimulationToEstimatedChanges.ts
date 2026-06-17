import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import type { SimulationState } from './simulation';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import { parseClassicAssetCodeIssuer } from '../../utils';
import { normalizeAmount } from '../../utils/currency';
import type { AssetMetadataService } from '../asset-metadata';
import { getIconUrl, getNativeAssetMetadata } from '../asset-metadata/utils';
import type { TransactionScanAssetChange } from '../transaction-scan';

/**
 * Builds a single estimated-change row from a signed balance delta.
 *
 * @param params - Row inputs.
 * @param params.delta - Signed balance delta in smallest units (negative = outflow).
 * @param params.decimals - Asset decimals used to normalize the raw delta.
 * @param params.symbol - Display ticker.
 * @param params.name - Display name.
 * @param params.logo - Icon URL, or null when unknown.
 * @returns A {@link TransactionScanAssetChange} with a human-readable value.
 */
function buildChange(params: {
  delta: BigNumber;
  decimals: number;
  symbol: string;
  name: string;
  logo: string | null;
}): TransactionScanAssetChange {
  const { delta, decimals, symbol, name, logo } = params;
  return {
    type: delta.isNegative() ? 'out' : 'in',
    value: normalizeAmount(delta.abs(), decimals).toNumber(),
    price: null,
    symbol,
    name,
    logo,
  };
}

/**
 * Diffs the signer's account between two local simulation snapshots and maps the
 * non-zero balance deltas into the {@link TransactionScanAssetChange} shape the
 * confirmation UI renders.
 *
 * Native XLM and classic (trustline) assets are diffed synchronously; SEP-41
 * contract tokens resolve their metadata via {@link AssetMetadataService}. The
 * caller is expected to pass the post-fee `initialState` so the network fee is
 * excluded from the resulting rows.
 *
 * @param params - Mapping inputs.
 * @param params.initialState - Post-fee simulation snapshot (baseline).
 * @param params.finalState - Snapshot after all operations are applied.
 * @param params.signerAddress - Stellar address whose balance changes are surfaced.
 * @param params.scope - CAIP-2 chain of the transaction.
 * @param params.assetMetadataService - Resolver for SEP-41 token metadata.
 * @returns The non-zero asset changes for the signer, or an empty array when the
 * signer is not present in both snapshots.
 */
export async function mapSimulationToEstimatedChanges(params: {
  initialState: SimulationState;
  finalState: SimulationState;
  signerAddress: string;
  scope: KnownCaip2ChainId;
  assetMetadataService: AssetMetadataService;
}): Promise<TransactionScanAssetChange[]> {
  const {
    initialState,
    finalState,
    signerAddress,
    scope,
    assetMetadataService,
  } = params;

  const initialAccount = initialState.accounts.get(signerAddress);
  const finalAccount = finalState.accounts.get(signerAddress);
  if (initialAccount === undefined || finalAccount === undefined) {
    return [];
  }

  const changes: TransactionScanAssetChange[] = [];

  // Native XLM.
  const nativeDelta = finalAccount.nativeRawBalance.minus(
    initialAccount.nativeRawBalance,
  );
  if (!nativeDelta.isZero()) {
    const meta = getNativeAssetMetadata(scope);
    changes.push(
      buildChange({
        delta: nativeDelta,
        decimals: meta.units[0].decimals,
        symbol: meta.symbol,
        name: meta.name ?? meta.symbol,
        logo: null,
      }),
    );
  }

  // Classic (trustline) assets.
  const classicAssetIds = new Set<KnownCaip19ClassicAssetId>([
    ...initialAccount.trustlines.keys(),
    ...finalAccount.trustlines.keys(),
  ]);
  for (const assetId of classicAssetIds) {
    const before = initialAccount.trustlines.get(assetId)?.balance ?? null;
    const after = finalAccount.trustlines.get(assetId)?.balance ?? null;
    const delta = (after ?? new BigNumber(0)).minus(before ?? new BigNumber(0));
    if (delta.isZero()) {
      continue;
    }
    const { assetReference } = parseCaipAssetType(assetId);
    const { assetCode } = parseClassicAssetCodeIssuer(assetReference);
    changes.push(
      buildChange({
        delta,
        decimals: STELLAR_DECIMAL_PLACES,
        symbol: assetCode,
        name: assetCode,
        logo: getIconUrl(assetId),
      }),
    );
  }

  // SEP-41 contract tokens.
  const sep41AssetIds = new Set<KnownCaip19Sep41AssetId>([
    ...initialAccount.sep41Balances.keys(),
    ...finalAccount.sep41Balances.keys(),
  ]);
  for (const assetId of sep41AssetIds) {
    const before = initialAccount.sep41Balances.get(assetId) ?? null;
    const after = finalAccount.sep41Balances.get(assetId) ?? null;
    const delta = (after ?? new BigNumber(0)).minus(before ?? new BigNumber(0));
    if (delta.isZero()) {
      continue;
    }
    const meta = await assetMetadataService.resolve(assetId);
    changes.push(
      buildChange({
        delta,
        decimals: meta.units[0].decimals,
        symbol: meta.symbol,
        name: meta.name ?? meta.symbol,
        logo: meta.iconUrl ?? null,
      }),
    );
  }

  return changes;
}
