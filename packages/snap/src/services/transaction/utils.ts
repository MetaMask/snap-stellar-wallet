import {
  TransactionStatus,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import { parseCaipAssetType } from '@metamask/utils';
import type { Operation } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { StellarOperationType } from './api';
import {
  InvalidInvokeContractStructureException,
  RequiresMemoException,
  TransactionExpireException,
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
import { SwapTransactionXdrStruct } from '../../api';
import { DUST_XLM_AMOUNT } from '../../constants';
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
  if (transaction.isInvokedByAccount(accountId)) {
    return;
  }
  throw new TransactionValidationException(
    'Transaction does not involve this wallet account',
  );
}

/**
 * Ensures the transaction has only one `invokeHostFunction` operation.
 *
 * @param transaction - Wrapped Stellar transaction.
 * @throws {InvalidInvokeContractStructureException} When the transaction has more than one `invokeHostFunction` operation.
 */
export function assertInvokeHostFunctionSoleOperation(
  transaction: Transaction,
): void {
  if (transaction.hasInvokeHostFunction && transaction.operationCount !== 1) {
    throw new InvalidInvokeContractStructureException();
  }
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

/**
 * Asserts the transaction has not expired.
 *
 * @param transaction - Wrapped Stellar transaction.
 * @throws {TransactionExpireException} When the transaction has expired.
 */
export function assertTransactionTimeBound(transaction: Transaction): void {
  const { expirationTime } = transaction;
  if (expirationTime === undefined) {
    return;
  }
  if (expirationTime < Math.floor(Date.now() / 1000)) {
    throw new TransactionExpireException(expirationTime);
  }
}

/**
 * Throws when `destRequiresMemo` is true and the envelope has no memo (SEP-29).
 *
 * @param transaction - Wrapped Stellar transaction.
 * @param destAccountId - Payment or path-payment destination.
 * @param destRequiresMemo - From {@link OnChainAccount.requiresMemo} or simulation state.
 * @throws {RequiresMemoException} When a memo is required but missing or blank.
 */
export function assertMemoWhenDestinationRequires(
  transaction: Transaction,
  destAccountId: string,
  destRequiresMemo: boolean,
): void {
  const memo = transaction.getMemo();
  // Whitespace-only memos count as missing under SEP-29.
  // Hence, we dont consider them.
  if (!destRequiresMemo || (memo !== null && /\S/u.test(memo))) {
    return;
  }
  throw new RequiresMemoException(destAccountId);
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

/**
 * Parses Stellar `maxTime` into a unix expiration timestamp.
 *
 * @param maxTime - `timeBounds.maxTime` from the envelope (unix seconds as a string).
 * @returns Parsed unix seconds, or `undefined` when there is no upper bound (`0`).
 */
export function parseExpirationMaxTime(
  maxTime: string | undefined,
): number | undefined {
  if (maxTime === undefined) {
    return undefined;
  }
  const parsed = parseInt(maxTime, 10);
  if (Number.isNaN(parsed) || parsed === 0) {
    return undefined;
  }
  return parsed;
}

/**
 * Detects if the operation is a path payment operation.
 *
 * @param operation - The operation to check.
 * @returns Whether the operation is a path payment operation.
 */
export function isPathPaymentOperation(
  operation: Operation,
): operation is
  | Operation.PathPaymentStrictSend
  | Operation.PathPaymentStrictReceive {
  return (
    operation.type === StellarOperationType.PathPaymentStrictSend ||
    operation.type === StellarOperationType.PathPaymentStrictReceive
  );
}

/**
 * Detects if the transaction is a swap based on the operation types crafted by the Bridge API.
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether the transaction is a self-to-self bridge swap.
 */
export function isSwapTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const isSwapXdr = SwapTransactionXdrStruct.is(transaction.getRaw().toXDR());
  const isSourceAccount = transaction.sourceAccount === accountAddress;
  if (!isSwapXdr || !isSourceAccount) {
    return false;
  }
  return transaction.transactionOperations.some(
    (operation) =>
      isPathPaymentOperation(operation) &&
      operation.destination === accountAddress,
  );
}

/**
 * Detects if the transaction is a bridge send from the Bridge API XDR envelope.
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether the transaction is a single-operation bridge send.
 */
export function isBridgeSendTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const isSwapXdr = SwapTransactionXdrStruct.is(transaction.getRaw().toXDR());
  const isSourceAccount = transaction.sourceAccount === accountAddress;
  if (!isSwapXdr || !isSourceAccount) {
    return false;
  }
  const operationTypes = transaction.transactionOperations;
  const [firstOperation] = operationTypes;
  if (
    operationTypes.length === 1 &&
    firstOperation &&
    [
      StellarOperationType.InvokeHostFunction,
      StellarOperationType.Payment,
      StellarOperationType.PathPaymentStrictSend,
      StellarOperationType.PathPaymentStrictReceive,
    ].includes(firstOperation.type as StellarOperationType)
  ) {
    return true;
  }
  return false;
}

/**
 * Detects if the transaction is a change-trust opt-in (limit > 0).
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether all operations are change-trust opt-ins for the account.
 */
export function isAddChangeTrustTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const operationTypes = transaction.transactionOperations;
  const isSourceAccount = transaction.sourceAccount === accountAddress;
  if (
    isSourceAccount &&
    operationTypes.every(
      (operation) =>
        operation.type === StellarOperationType.ChangeTrust &&
        // We consider any non-zero limit as an opt-in.
        new BigNumber(operation.limit).isGreaterThan(0),
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Detects if the transaction is a change-trust opt-out (limit = 0).
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether all operations are change-trust removals for the account.
 */
export function isRemoveChangeTrustTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const isSourceAccount = transaction.sourceAccount === accountAddress;
  const operationTypes = transaction.transactionOperations;
  if (
    isSourceAccount &&
    operationTypes.every(
      (operation) =>
        operation.type === StellarOperationType.ChangeTrust &&
        new BigNumber(operation.limit).isZero(),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detects if the transaction is a send (payment or create-account operations only).
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether the transaction is a send from the account.
 */
export function isSendTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const operationTypes = transaction.transactionOperations;
  const isSourceAccount = transaction.sourceAccount === accountAddress;
  if (
    isSourceAccount &&
    operationTypes.every(
      (operation) =>
        operation.type === StellarOperationType.Payment ||
        operation.type === StellarOperationType.CreateAccount,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detects if the transaction is a dust payment transaction.
 *
 * @param transaction - The transaction to check.
 * @param accountAddress - The Stellar address of the transaction owner.
 * @returns Whether the transaction is a dust payment transaction.
 */
export function isDustPaymentTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const operationTypes = transaction.transactionOperations;
  if (
    operationTypes.some(
      (operation) =>
        operation.type === StellarOperationType.Payment &&
        operation.destination === accountAddress &&
        operation.asset.isNative() &&
        operation.amount === DUST_XLM_AMOUNT,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detects whether a Stellar operation credits the given account.
 *
 * A receive operation is one where `accountAddress` is the destination,
 * regardless of who signed or sourced the transaction.
 *
 * @param operation - Stellar operation to evaluate.
 * @param accountAddress - Stellar address that may receive funds from the operation.
 * @returns Whether the operation credits `accountAddress`.
 */
export function isReceiveOperation(
  operation: Operation,
  accountAddress: string,
): operation is
  | Operation.Payment
  | Operation.CreateAccount
  | Operation.PathPaymentStrictReceive
  | Operation.PathPaymentStrictSend {
  return (
    // Payment operation that sends to the account, regardless the source account.
    (operation.type === StellarOperationType.Payment &&
      operation.destination === accountAddress) ||
    // Create account operation that creates the account, regardless the source account.
    (operation.type === StellarOperationType.CreateAccount &&
      operation.destination === accountAddress) ||
    // Path payment strict receive operation that credits the account, regardless of the source account.
    (operation.type === StellarOperationType.PathPaymentStrictReceive &&
      operation.destination === accountAddress) ||
    // Path payment strict send operation that credits the account, regardless of the source account.
    (operation.type === StellarOperationType.PathPaymentStrictSend &&
      operation.destination === accountAddress)
  );
}

/**
 * Detects whether a transaction includes any operation that credits the given account.
 *
 * @param transaction - Wrapped on-chain transaction.
 * @param accountAddress - Stellar address to check for incoming credits.
 * @returns Whether at least one operation in the transaction credits `accountAddress`.
 */
export function isReceiveTransaction(
  transaction: Transaction,
  accountAddress: string,
): boolean {
  const operationTypes = transaction.transactionOperations;
  if (
    operationTypes.some((operation) =>
      isReceiveOperation(operation, accountAddress),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detects if the transaction status is pending.
 *
 * @param status - The transaction status to check.
 * @returns Whether the transaction status is pending.
 */
export function isPendingTransactionStatus(
  status: KeyringTransaction['status'],
): boolean {
  return (
    status === `${TransactionStatus.Submitted}` ||
    status === `${TransactionStatus.Unconfirmed}`
  );
}

/**
 * Detects if the transaction status is terminal (confirmed or failed).
 *
 * @param status - The transaction status to check.
 * @returns Whether the transaction status is completed.
 */
export function isCompletedTransactionStatus(
  status: KeyringTransaction['status'],
): boolean {
  return (
    status === `${TransactionStatus.Failed}` ||
    status === `${TransactionStatus.Confirmed}`
  );
}
