import type { Operation } from '@stellar/stellar-sdk';
import { Address, scValToNative } from '@stellar/stellar-sdk';

import { TransactionValidationException } from '../exceptions';
import type {
  AccountState,
  Sep41TokenBalanceMapKey,
  SimulationState,
} from './api';
import type { KnownCaip19Sep41AssetId, KnownCaip2ChainId } from '../../../api';
import { toCaip19Sep41AssetId } from '../../../utils';
import { parseScValToNative } from '../../network/utils';
import { calculateSpendableBalance } from '../../on-chain-account/utils';
/**
 * Gets the effective source account ID from the operation.
 * Returns the source account ID from the operation if it is set, otherwise returns the transaction source.
 *
 * @param op - The operation.
 * @param txSource - The transaction source.
 * @returns Effective source account public key.
 */
export function effectiveSource(op: Operation, txSource: string): string {
  return op.source ?? txSource;
}

/**
 * Calculates the spendable native balance for an account.
 *
 * @param account - The account state.
 * @returns Spendable native balance in stroops.
 */
export function getSpendableNative(account: AccountState): BigNumber {
  return calculateSpendableBalance({
    nativeBalance: account.nativeRawBalance,
    subentryCount: account.subentryCount,
    numSponsoring: account.numSponsoring,
    numSponsored: account.numSponsored,
  });
}

/**
 * Gets the account state from the simulation state.
 *
 * @param state - The simulation state.
 * @param accountId - The account ID.
 * @returns Mutable account state for the given id.
 */
export function getAccount(
  state: SimulationState,
  accountId: string,
): AccountState {
  const account = state.accounts.get(accountId);
  if (account === undefined) {
    throw new TransactionValidationException(
      `Account not loaded: ${accountId}`,
    );
  }
  return account;
}

export type ParsedSep41TransferInvoke = {
  /**
   * Canonical SEP-41 CAIP-19 id for the **invoked contract** — not a separate XDR field.
   * Same encoding as {@link TransactionBuilder.sep41Transfer}: `toCaip19Sep41AssetId(scope, contractId)`.
   */
  assetId: KnownCaip19Sep41AssetId;
  fromAccountId: string;
  amount: BigNumber;
};

/**
 * When the op is a single-contract `transfer(from, to, amount)` (SEP-41 token shape),
 * reads **contract address** from the invoke target and **derives** the CAIP-19 asset id with `scope`
 * (the envelope never embeds a CAIP string — only `C…` like `Contract.call`).
 * {@link TransactionBuilder.sep41Transfer} is the same function that is used to build the transaction.
 *
 * @param op - Parsed `invokeHostFunction` operation.
 * @param scope - CAIP-2 chain id (must match the envelope network when matching preload keys).
 * @returns Parsed transfer metadata, or `null` if the shape does not match.
 */
export function tryParseSep41TransferInvoke(
  op: Operation.InvokeHostFunction,
  scope: KnownCaip2ChainId,
): ParsedSep41TransferInvoke | null {
  const { func } = op;
  if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
    return null;
  }
  const ic = func.invokeContract();
  // if it is not a transfer function, we can skip parsing the transfer metadata
  if (ic.functionName().toString() !== 'transfer') {
    return null;
  }

  const args = ic.args();
  if (args.length !== 3 || args[0] === undefined || args[2] === undefined) {
    throw new TransactionValidationException(
      'Invalid transfer function arguments',
    );
  }
  // First argument is the from address
  const fromArg = args[0];
  // Third argument is the amount
  const amountArg = args[2];

  const contractAddr = Address.fromScAddress(ic.contractAddress()).toString();

  const fromNative = scValToNative(fromArg);
  const amountNative = scValToNative(amountArg);
  if (typeof fromNative !== 'string' || !fromNative.startsWith('G')) {
    throw new TransactionValidationException('Invalid from address');
  }

  return {
    assetId: toCaip19Sep41AssetId(scope, contractAddr),
    fromAccountId: fromNative,
    amount: parseScValToNative(amountNative),
  };
}

/**
 * Map key for {@link SimulationState.preloadedTokenBalance}: `accountId` and SEP-41 `assetId` (order matters).
 *
 * @param accountId - Stellar account id of the token holder (`G…`).
 * @param assetId - SEP-41 CAIP-19 asset id for the token contract.
 * @returns Opaque composite map key.
 */
export function toSep41TokenBalanceMapKey(
  accountId: string,
  assetId: KnownCaip19Sep41AssetId,
): Sep41TokenBalanceMapKey {
  return `${accountId}-${assetId}`;
}
