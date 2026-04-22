import { parseCaipAssetType } from '@metamask/utils';
import { Asset } from '@stellar/stellar-sdk';

import {
  TransactionScopeNotMatchException,
  TransactionValidationException,
} from './exceptions';
import type {
  ReadableOperationField,
  ReadableTransactionJson,
} from './OperationMapper';
import type { Transaction } from './Transaction';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import {
  getSlip44AssetId,
  isClassicAssetId,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
  toCaip19ClassicAssetId,
} from '../../utils';

/**
 * Returns the Stellar asset for the given CAIP-19 asset ID.
 * SEP-41 is not supported.
 *
 * @param assetId - The CAIP-19 asset ID.
 * @returns The Stellar asset.
 * @throws If the asset is not slip44 or classic asset.
 */
export function caip19ToStellarAsset(
  assetId: KnownCaip19AssetIdOrSlip44Id,
): Asset {
  if (isSlip44Id(assetId)) {
    return Asset.native();
  }
  if (isClassicAssetId(assetId)) {
    const { assetReference } = parseCaipAssetType(assetId);
    const { assetCode, assetIssuer } =
      parseClassicAssetCodeIssuer(assetReference);
    return new Asset(assetCode, assetIssuer);
  }
  throw new Error(`Invalid asset id: ${assetId}`);
}

/**
 * Ensures the envelope’s network matches the expected chain before network I/O or simulation.
 *
 * @param transaction - Wrapped Stellar transaction.
 * @param expectedScope - CAIP-2 chain ID the caller intends.
 * @throws {TransactionScopeNotMatchException} When {@link Transaction.scope} differs from `expectedScope`.
 */
export function assertTransactionScope(
  transaction: Transaction,
  expectedScope: KnownCaip2ChainId,
): void {
  const transactionScope = transaction.scope;
  if (transactionScope !== expectedScope) {
    throw new TransactionScopeNotMatchException(
      expectedScope,
      transactionScope,
    );
  }
}

/**
 * Ensures the given wallet account appears on the envelope as source or fee source.
 *
 * @param transaction - Wrapped Stellar transaction.
 * @param accountId - Wallet account id expected to be involved.
 * @throws {TransactionValidationException} When the wallet account is not on the envelope.
 */
export function assertTransactionSourceAccount(
  transaction: Transaction,
  accountId: string,
): void {
  if (transaction.isSourceAccount(accountId)) {
    return;
  }
  throw new TransactionValidationException(
    'Transaction does not involve this wallet account as source account or fee source',
  );
}

/**
 * Ensures the given wallet account is involved by tx source, fee source, or any operation source.
 *
 * @param transaction - Wrapped Stellar transaction.
 * @param accountId - Wallet account id expected to participate in signing.
 * @throws {TransactionValidationException} When the wallet account is not involved in the transaction.
 */
export function assertAccountInvolvesTransaction(
  transaction: Transaction,
  accountId: string,
): void {
  if (transaction.hasParticipatingAccount(accountId)) {
    return;
  }
  throw new TransactionValidationException(
    'Transaction does not involve this wallet account',
  );
}

/**
 * Maps an `OperationMapper` asset reference to its CAIP-19 id.
 *
 * @param scope - CAIP-2 chain of the transaction.
 * @param assetReference - Either `'native'` or a classic `CODE-ISSUER` / `CODE:ISSUER` string.
 * @returns The CAIP-19 id, or `null` when the reference cannot be parsed
 * (e.g. liquidity pool ids that arrive on `setTrustLineFlags` / `revokeSponsorship`).
 */
export function parseOperationAssetReference(
  scope: KnownCaip2ChainId,
  assetReference: string,
): KnownCaip19AssetIdOrSlip44Id | null {
  if (assetReference === 'native') {
    return getSlip44AssetId(scope);
  }
  try {
    const { assetCode, assetIssuer } =
      parseClassicAssetCodeIssuer(assetReference);
    return toCaip19ClassicAssetId(scope, assetCode, assetIssuer);
  } catch {
    return null;
  }
}

/**
 * Pulls the asset reference string out of an `OperationMapper` row when it carries one.
 *
 * @param param - One field on a {@link ReadableOperationJson}.
 * @returns The reference string, or `null` for rows that don't represent an asset.
 */
function getAssetReferenceFromField(
  param: ReadableOperationField,
): string | null {
  if (param.type === 'assetWithAmount' && Array.isArray(param.value)) {
    const [reference] = param.value as [string, string];
    return reference;
  }
  if (param.type === 'asset' && typeof param.value === 'string') {
    return param.value;
  }
  return null;
}

/**
 * Collects the unique CAIP-19 ids referenced by a transaction's operations.
 *
 * @param scope - CAIP-2 chain of the transaction.
 * @param readable - Transaction summary produced by `OperationMapper`.
 * @returns Deduplicated CAIP-19 ids; references that can't be resolved are skipped.
 */
export function collectTransactionAssetCaipIds(
  scope: KnownCaip2ChainId,
  readable: ReadableTransactionJson,
): KnownCaip19AssetIdOrSlip44Id[] {
  const ids = new Set<KnownCaip19AssetIdOrSlip44Id>();
  for (const operation of readable.operations) {
    for (const param of operation.params) {
      const reference = getAssetReferenceFromField(param);
      if (reference === null) {
        continue;
      }
      const assetId = parseOperationAssetReference(scope, reference);
      if (assetId !== null) {
        ids.add(assetId);
      }
    }
  }
  return [...ids];
}
