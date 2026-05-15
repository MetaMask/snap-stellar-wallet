import type { Operation } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { OperationSimulator, Context, AccountState } from './api';
import {
  getAccount,
  effectiveSource,
  getSpendableNative,
  tryParseSep41TransferInvoke,
} from './utils';
import type {
  KnownCaip19ClassicAssetId,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
} from '../../../api';
import { BASE_RESERVE_STROOPS, MAX_INT64 } from '../../../constants';
import {
  getSlip44AssetId,
  isSlip44Id,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../../utils';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverBaseReserveException,
  InvalidAmountForCreateAccountException,
  InvalidTrustlineException,
  RemoveTrustlineWithNonZeroBalanceException,
  TransactionValidationException,
  TrustlineNotAuthorizedException,
  TrustlineNotFoundException,
  UpdateTrustlineException,
} from '../exceptions';

type ClassicAssetId = KnownCaip19ClassicAssetId | KnownCaip19Slip44Id;

type PathPaymentOP =
  | Operation.PathPaymentStrictReceive
  | Operation.PathPaymentStrictSend;

/**
 * Converts a Stellar SDK native or classic asset to this Snap's CAIP asset id form.
 *
 * @param asset - The SDK asset value from the operation.
 * @param scope - The CAIP-2 chain id for the transaction.
 * @returns The corresponding native or classic CAIP asset id.
 */
function classicAssetToId(
  asset: unknown,
  scope: KnownCaip2ChainId,
): ClassicAssetId {
  if (asset instanceof Asset) {
    if (asset.isNative()) {
      return getSlip44AssetId(scope);
    }
    return toCaip19ClassicAssetId(scope, asset.getCode(), asset.getIssuer());
  }
  throw new TransactionValidationException(
    'Only native or alphanum Asset payments are supported for sequential validation',
  );
}

/**
 * Validates that an account can spend a native or classic asset amount.
 *
 * @param params - Validation parameters.
 * @param params.account - Source account state.
 * @param params.accountId - Source account id for error reporting.
 * @param params.assetId - Asset being debited.
 * @param params.amount - Amount in smallest units.
 */
function validateDebit(params: {
  account: AccountState;
  accountId: string;
  assetId: ClassicAssetId;
  amount: BigNumber;
}): void {
  const { account, accountId, assetId, amount } = params;

  if (isSlip44Id(assetId)) {
    const spendable = getSpendableNative(account);
    if (spendable.isLessThan(amount)) {
      throw new InsufficientBalanceException(
        spendable.toString(),
        amount.toString(),
      );
    }
    return;
  }

  // verify if the source account has trustline and the spending amount not exceed the trustline balance
  const line = account.trustlines.get(assetId);
  if (line === undefined) {
    throw new TrustlineNotFoundException(assetId, accountId);
  }

  if (!line.authorized) {
    throw new TrustlineNotAuthorizedException(assetId, accountId);
  }

  if (line.balance.isLessThan(amount)) {
    throw new InsufficientBalanceException(
      line.balance.toString(),
      amount.toString(),
    );
  }
}

/**
 * Validates that an account can receive a native or classic asset amount.
 *
 * @param params - Validation parameters.
 * @param params.account - Destination account state.
 * @param params.accountId - Destination account id for error reporting.
 * @param params.assetId - Asset being credited.
 * @param params.amount - Amount in smallest units.
 * @param params.balanceAfterDebit - Optional post-debit balance on the same row (native or trustline) when credit follows a debit on the same account+asset; enables correct limit checks for self-payments and path payments to self.
 */
function validateCredit(params: {
  account: AccountState;
  accountId: string;
  assetId: ClassicAssetId;
  amount: BigNumber;
  balanceAfterDebit?: BigNumber;
}): void {
  const { account, accountId, assetId, amount, balanceAfterDebit } = params;

  if (isSlip44Id(assetId)) {
    const nativeBalance = balanceAfterDebit ?? account.nativeRawBalance;
    const newNativeBalance = nativeBalance.plus(amount);
    if (newNativeBalance.isGreaterThan(new BigNumber(MAX_INT64))) {
      throw new TransactionValidationException(
        'Payment would exceed maximum int64 balance for destination',
      );
    }
    return;
  }

  // verify if the destination account has trustline and the receiving amount not exceed the trustline limit
  const line = account.trustlines.get(assetId);
  if (line === undefined) {
    throw new TrustlineNotFoundException(assetId, accountId);
  }

  if (!line.authorized) {
    throw new TrustlineNotAuthorizedException(assetId, accountId);
  }

  const trustlineBalance = balanceAfterDebit ?? line.balance;
  const newBalance = trustlineBalance.plus(amount);
  if (newBalance.isGreaterThan(line.limit)) {
    throw new TransactionValidationException(
      `Payment would exceed trustline limit for asset ${assetId} on destination`,
    );
  }
}

/**
 * Applies a debit for a native or classic asset amount.
 *
 * @param params - Debit parameters.
 * @param params.account - Account state to mutate.
 * @param params.assetId - Asset being debited.
 * @param params.amount - Amount in smallest units.
 */
function applyDebit(params: {
  account: AccountState;
  assetId: ClassicAssetId;
  amount: BigNumber;
}): void {
  const { account, assetId, amount } = params;

  if (isSlip44Id(assetId)) {
    account.nativeRawBalance = account.nativeRawBalance.minus(amount);
    return;
  }

  const line = account.trustlines.get(assetId);
  if (line !== undefined) {
    line.balance = line.balance.minus(amount);
  }
}

/**
 * Applies a credit for a native or classic asset amount.
 *
 * @param params - Credit parameters.
 * @param params.account - Account state to mutate.
 * @param params.assetId - Asset being credited.
 * @param params.amount - Amount in smallest units.
 */
function applyCredit(params: {
  account: AccountState;
  assetId: ClassicAssetId;
  amount: BigNumber;
}): void {
  const { account, assetId, amount } = params;

  if (isSlip44Id(assetId)) {
    account.nativeRawBalance = account.nativeRawBalance.plus(amount);
    return;
  }

  const line = account.trustlines.get(assetId);
  if (line !== undefined) {
    line.balance = line.balance.plus(amount);
  }
}

export class PaymentOPSimulator implements OperationSimulator {
  validate(ctx: Context, op: Operation.Payment): void {
    const payment = op;
    const { opIndex } = ctx;
    const { assetId, payAmt, source, dest, sourceId, destId } =
      this.#getContextData(ctx, op);

    if (payment.amount === undefined || payment.amount === null) {
      throw new TransactionValidationException(
        `Payment operation at index ${opIndex} has no amount`,
      );
    }

    validateDebit({
      account: source,
      accountId: sourceId,
      assetId,
      amount: payAmt,
    });

    let balanceAfterDebit: BigNumber | undefined;
    // Special handle for self-payment
    if (sourceId === destId) {
      if (isSlip44Id(assetId)) {
        balanceAfterDebit = source.nativeRawBalance.minus(payAmt);
      } else {
        const line = source.trustlines.get(assetId);
        if (line !== undefined) {
          balanceAfterDebit = line.balance.minus(payAmt);
        }
      }
    }

    validateCredit({
      account: dest,
      accountId: destId,
      assetId,
      amount: payAmt,
      balanceAfterDebit,
    });
  }

  apply(ctx: Context, op: Operation.Payment): void {
    const { assetId, payAmt, source, dest } = this.#getContextData(ctx, op);

    applyDebit({ account: source, assetId, amount: payAmt });
    applyCredit({ account: dest, assetId, amount: payAmt });
  }

  #getContextData(
    ctx: Context,
    op: Operation.Payment,
  ): {
    sourceId: string;
    destId: string;
    payAmt: BigNumber;
    assetId: ClassicAssetId;
    source: AccountState;
    dest: AccountState;
  } {
    const { txSource, scope, state } = ctx;
    const payment = op;
    const sourceId = effectiveSource(payment, txSource);
    const destId = this.#paymentDestinationAccountId(payment);
    const payAmt = toSmallestUnit(new BigNumber(payment.amount));
    const assetId = classicAssetToId(payment.asset, scope);
    const source = getAccount(state, sourceId);
    const dest = getAccount(state, destId);
    return { sourceId, destId, payAmt, assetId, source, dest };
  }

  #paymentDestinationAccountId(op: Operation.Payment): string {
    const { destination } = op;
    if (typeof destination === 'string') {
      return destination;
    }
    throw new TransactionValidationException(
      'Unsupported payment destination type',
    );
  }
}

export class PathPaymentOPSimulator implements OperationSimulator {
  validate(ctx: Context, op: PathPaymentOP): void {
    const { source, sourceId, sendAssetId, sendAmount } = this.#sourceData(
      ctx,
      op,
    );
    const { dest, destId, destAssetId, destAmount } = this.#destinationData(
      ctx,
      op,
    );

    validateDebit({
      account: source,
      accountId: sourceId,
      assetId: sendAssetId,
      amount: sendAmount,
    });

    let balanceAfterDebit: BigNumber | undefined;
    // Special handle for path payment to self
    if (sourceId === destId && sendAssetId === destAssetId) {
      if (isSlip44Id(sendAssetId) && isSlip44Id(destAssetId)) {
        balanceAfterDebit = source.nativeRawBalance.minus(sendAmount);
      } else if (!isSlip44Id(destAssetId)) {
        const line = source.trustlines.get(destAssetId);
        if (line !== undefined) {
          balanceAfterDebit = line.balance.minus(sendAmount);
        }
      }
    }

    validateCredit({
      account: dest,
      accountId: destId,
      assetId: destAssetId,
      amount: destAmount,
      balanceAfterDebit,
    });
  }

  apply(ctx: Context, op: PathPaymentOP): void {
    const { source, sendAssetId, sendAmount } = this.#sourceData(ctx, op);
    const { dest, destAssetId, destAmount } = this.#destinationData(ctx, op);

    applyDebit({
      account: source,
      assetId: sendAssetId,
      amount: sendAmount,
    });
    applyCredit({
      account: dest,
      assetId: destAssetId,
      amount: destAmount,
    });
  }

  #sourceData(
    ctx: Context,
    op: PathPaymentOP,
  ): {
    source: AccountState;
    sourceId: string;
    sendAssetId: ClassicAssetId;
    sendAmount: BigNumber;
  } {
    const { txSource, scope, state } = ctx;
    const sourceId = effectiveSource(op, txSource);
    const source = getAccount(state, sourceId);
    const sendAssetId = classicAssetToId(op.sendAsset, scope);
    const sendAmount =
      op.type === 'pathPaymentStrictSend' ? op.sendAmount : op.sendMax;

    return {
      source,
      sourceId,
      sendAssetId,
      sendAmount: toSmallestUnit(new BigNumber(sendAmount)),
    };
  }

  #destinationData(
    ctx: Context,
    op: PathPaymentOP,
  ): {
    dest: AccountState;
    destId: string;
    destAssetId: ClassicAssetId;
    destAmount: BigNumber;
  } {
    const { scope, state } = ctx;
    const { destination } = op;
    const dest = getAccount(state, destination);
    const destAssetId = classicAssetToId(op.destAsset, scope);
    const destAmount =
      op.type === 'pathPaymentStrictSend' ? op.destMin : op.destAmount;

    return {
      dest,
      destId: destination,
      destAssetId,
      destAmount: toSmallestUnit(new BigNumber(destAmount)),
    };
  }
}

export class CreateAccountOPSimulator implements OperationSimulator {
  validate(ctx: Context, op: Operation.CreateAccount): void {
    const { state, opIndex } = ctx;
    if (typeof op.destination !== 'string' || op.destination.length === 0) {
      throw new TransactionValidationException(
        `CreateAccount at index ${opIndex} has no destination`,
      );
    }
    const { source, destId, startingBalance } = this.#getContextData(ctx, op);

    // Minimum starting balance is 1 XLM if we are not sponsoring the account
    const minCreate = toSmallestUnit(new BigNumber(1));

    if (startingBalance.isLessThan(minCreate)) {
      throw new InvalidAmountForCreateAccountException(
        startingBalance.toString(),
      );
    }

    const spendable = getSpendableNative(source);
    if (spendable.isLessThan(startingBalance)) {
      throw new InsufficientBalanceException(
        spendable.toString(),
        startingBalance.toString(),
      );
    }

    const existing = state.accounts.get(destId);
    if (existing !== undefined) {
      throw new TransactionValidationException(
        `CreateAccount destination already exists in simulation: ${destId}`,
      );
    }
  }

  apply(ctx: Context, op: Operation.CreateAccount): void {
    const { state } = ctx;
    const { source, destId, startingBalance } = this.#getContextData(ctx, op);

    source.nativeRawBalance = source.nativeRawBalance.minus(startingBalance);

    state.accounts.set(destId, {
      nativeRawBalance: startingBalance,
      subentryCount: 0,
      numSponsoring: 0,
      numSponsored: 0,
      trustlines: new Map(),
      sep41Balances: new Map(),
    });
  }

  #getContextData(
    ctx: Context,
    op: Operation.CreateAccount,
  ): { source: AccountState; destId: string; startingBalance: BigNumber } {
    const { txSource, state } = ctx;
    const funderId = effectiveSource(op, txSource);
    const destId = op.destination;
    const startingBalance = toSmallestUnit(new BigNumber(op.startingBalance));
    const source = getAccount(state, funderId);
    return { source, destId, startingBalance };
  }
}

export class ChangeTrustOPSimulator implements OperationSimulator {
  validate(ctx: Context, op: Operation.ChangeTrust): void {
    const { opIndex } = ctx;
    if (
      op.limit === undefined ||
      op.limit === null ||
      op.line === undefined ||
      op.line === null
    ) {
      throw new InvalidTrustlineException(
        `ChangeTrust at index ${opIndex} is incomplete`,
      );
    }

    const { source, sourceId, assetId, trustlineLimit } = this.#getContextData(
      ctx,
      op,
    );

    const sourceTrustline = source.trustlines.get(assetId);
    const isRemove = trustlineLimit.isZero();

    // if it is removing an existing trustline, verify if the trustline exists and if the balance is zero
    if (isRemove) {
      if (sourceTrustline === undefined) {
        throw new TrustlineNotFoundException(assetId, sourceId);
      }
      if (sourceTrustline.balance.isGreaterThan(0)) {
        throw new RemoveTrustlineWithNonZeroBalanceException(
          `Cannot remove trustline for ${assetId}: balance must be zero`,
        );
      }
      return;
    }

    // if it is adding a new trustline, verify if the source has enough balance to cover the base reserve
    if (sourceTrustline === undefined) {
      const spendable = getSpendableNative(source);
      const reserve = new BigNumber(BASE_RESERVE_STROOPS);
      if (spendable.isLessThan(reserve)) {
        throw new InsufficientBalanceToCoverBaseReserveException(
          spendable.toString(),
          reserve.toString(),
        );
      }
      return;
    }

    // if it is updating an existing trustline, verify if the limit is lower than the current balance
    if (trustlineLimit.isLessThan(sourceTrustline.balance)) {
      throw new UpdateTrustlineException(
        `ChangeTrust limit cannot be below current balance for ${assetId}`,
      );
    }
  }

  apply(ctx: Context, op: Operation.ChangeTrust): void {
    const { source, assetId, trustlineLimit } = this.#getContextData(ctx, op);

    const sourceTrustline = source.trustlines.get(assetId);
    const isRemove = trustlineLimit.isZero();

    // if it is removing an existing trustline, we need to update the source account subentry and numSponsored for spendable balance calculation:
    // - decrease the subentry count by 1
    // - decrease the numSponsored by 1 if the trustline is sponsored
    if (isRemove) {
      // Safe guard
      if (sourceTrustline !== undefined) {
        source.subentryCount = Math.max(0, source.subentryCount - 1);
        if (sourceTrustline.sponsored) {
          source.numSponsored = Math.max(0, source.numSponsored - 1);
        }
        source.trustlines.delete(assetId);
      }
      return;
    }

    // if it is adding a new trustline, we need to update the source account subentry for spendable balance calculation:
    // - increase the subentry count by 1
    if (sourceTrustline === undefined) {
      source.trustlines.set(assetId, {
        balance: new BigNumber(0),
        limit: trustlineLimit,
        // assume we always authorize the trustline for source account.
        authorized: true,
        // assume we only support enable the trustline for source account, but not sponsor to other accounts
        sponsored: false,
      });
      source.subentryCount += 1;
      return;
    }

    sourceTrustline.limit = trustlineLimit;
  }

  #getContextData(
    ctx: Context,
    op: Operation.ChangeTrust,
  ): {
    source: AccountState;
    sourceId: string;
    assetId: KnownCaip19ClassicAssetId;
    trustlineLimit: BigNumber;
  } {
    const { txSource, state, scope } = ctx;
    const sourceId = effectiveSource(op, txSource);
    const source = getAccount(state, sourceId);
    const asset = op.line;
    if (!(asset instanceof Asset)) {
      throw new InvalidTrustlineException(
        `ChangeTrust line must be Stellar SAC Asset or Stellar Classic Asset, ${asset.constructor.name} is not supported`,
      );
    }

    const assetId = toCaip19ClassicAssetId(
      scope,
      asset.getCode(),
      asset.getIssuer(),
    );

    // Operation limit is in human-readable form; convert to stroops like Horizon balances.
    const limit = new BigNumber(op.limit);
    const trustlineLimit = limit.isZero()
      ? new BigNumber(0)
      : toSmallestUnit(limit);

    return { source, sourceId, assetId, trustlineLimit };
  }
}

export class InvokeHostFunctionOPSimulator implements OperationSimulator {
  validate(ctx: Context, op: Operation.InvokeHostFunction): void {
    const { txSource, state, scope } = ctx;
    const sourceId = effectiveSource(op, txSource);
    // Contract transaction should always be sourced from the user wallet account
    // `getAccount` will throw if the source account is not found in the simulation state,
    // hence, it should protect if the actual source account is not same as user wallet account
    const senderState = getAccount(state, sourceId);

    // handle the SEP-41 transfer operation
    const parsed = tryParseSep41TransferInvoke(op, scope);
    if (parsed === null) {
      // Not a SEP-41 `transfer`; skip contract-token balance validation (other invokes ignore SEP-41 rows).
      return;
    }

    const { fromAccountId, assetId, amount } = parsed;

    // safe guard to prevent the from account is different from the source account.
    if (fromAccountId !== sourceId) {
      throw new TransactionValidationException(
        'SEP-41 transfer requires the sender account to be the same as the source account',
      );
    }

    const onChainBalance = senderState.sep41Balances.get(assetId);
    if (onChainBalance === undefined) {
      throw new TransactionValidationException(
        'SEP-41 transfer requires a SEP-41 token balance on the sender account snapshot for this contract',
      );
    }

    if (onChainBalance.isLessThan(amount)) {
      throw new InsufficientBalanceException(
        onChainBalance.toString(),
        amount.toString(),
      );
    }
  }

  apply(_ctx: Context, _op: Operation.InvokeHostFunction): void {
    // InvokeHostFunction is a single operation transaction,
    // hence we don't need to apply any balance or trustline effects for Soroban invoke during simulation.
  }
}
