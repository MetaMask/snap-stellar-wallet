import { parseCaipAssetType } from '@metamask/utils';
import { Asset } from '@stellar/stellar-sdk';

import {
  TransactionScopeNotMatchException,
  TransactionValidationException,
} from './exceptions';
import type { Transaction } from './Transaction';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import {
  isClassicAssetId,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
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
 * Ensures a CAIP asset identifier belongs to the caller-provided scope.
 *
 * @param assetId - CAIP-19 or slip44 asset id.
 * @param expectedScope - CAIP-2 chain ID expected by caller.
 * @throws {TransactionValidationException} When the asset chain id differs from `expectedScope`.
 */
export function assertAssetScopeMatch(
  assetId: KnownCaip19AssetIdOrSlip44Id,
  expectedScope: KnownCaip2ChainId,
): void {
  const { chainId } = parseCaipAssetType(assetId);
  if (chainId !== String(expectedScope)) {
    throw new TransactionValidationException(
      `Asset ${assetId} scope does not match expected scope ${expectedScope}`,
    );
  }
}
