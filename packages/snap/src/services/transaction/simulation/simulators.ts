import type { Operation } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { OperationSimulator, Context, AccountState } from './api';
import {
  getAccount,
  effectiveSource,
  getSpendableNative,
  tryParseSep41TransferInvoke,
  toSep41TokenBalanceMapKey,
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

    // verify if the asset is a native asset and if the source has enough balance
    if (isSlip44Id(assetId)) {
      const spendable = getSpendableNative(source);
      if (spendable.isLessThan(payAmt)) {
        throw new InsufficientBalanceException(
          spendable.toString(),
          payAmt.toString(),
        );
      }
      const newDestNative = dest.nativeRawBalance.plus(payAmt);
      if (newDestNative.isGreaterThan(new BigNumber(MAX_INT64))) {
        throw new TransactionValidationException(
          'Payment would exceed maximum int64 balance for destination',
        );
      }
      return;
    }

    // verify if the trustline exists and if the source has enough balance
    const line = source.trustlines.get(assetId);
    if (line === undefined) {
      throw new TrustlineNotFoundException(assetId, sourceId);
    }

    if (!line.authorized) {
      throw new TrustlineNotAuthorizedException(assetId, sourceId);
    }

    if (line.balance.isLessThan(payAmt)) {
      throw new InsufficientBalanceException(
        line.balance.toString(),
        payAmt.toString(),
      );
    }

    // verify if the destination has trustline and the receiving amount not exceed the trustline limit
    const destLine = dest.trustlines.get(assetId);
    if (destLine === undefined) {
      throw new TrustlineNotFoundException(assetId, destId);
    }

    if (!destLine.authorized) {
      throw new TrustlineNotAuthorizedException(assetId, destId);
    }

    const newBalance = destLine.balance.plus(payAmt);
    if (newBalance.isGreaterThan(destLine.limit)) {
      throw new TransactionValidationException(
        `Payment would exceed trustline limit for asset ${assetId} on destination`,
      );
    }
  }

  apply(ctx: Context, op: Operation.Payment): void {
    const { assetId, payAmt, source, dest } = this.#getContextData(ctx, op);

    if (isSlip44Id(assetId)) {
      source.nativeRawBalance = source.nativeRawBalance.minus(payAmt);
      dest.nativeRawBalance = dest.nativeRawBalance.plus(payAmt);
      return;
    }

    const srcLine = source.trustlines.get(assetId);
    const destLine = dest.trustlines.get(assetId);
    if (srcLine !== undefined) {
      srcLine.balance = srcLine.balance.minus(payAmt);
    }
    if (destLine !== undefined) {
      destLine.balance = destLine.balance.plus(payAmt);
    }
  }

  #getContextData(
    ctx: Context,
    op: Operation.Payment,
  ): {
    sourceId: string;
    destId: string;
    payAmt: BigNumber;
    assetId: KnownCaip19ClassicAssetId | KnownCaip19Slip44Id;
    source: AccountState;
    dest: AccountState;
  } {
    const { txSource, scope, state } = ctx;
    const payment = op;
    const sourceId = effectiveSource(payment, txSource);
    const destId = this.#paymentDestinationAccountId(payment);
    const payAmt = toSmallestUnit(new BigNumber(payment.amount));
    const assetId = this.#paymentAssetToId(payment, scope);
    const source = getAccount(state, sourceId);
    const dest = getAccount(state, destId);
    return { sourceId, destId, payAmt, assetId, source, dest };
  }

  #paymentAssetToId(
    op: Operation.Payment,
    scope: KnownCaip2ChainId,
  ): KnownCaip19ClassicAssetId | KnownCaip19Slip44Id {
    const { asset } = op;
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
    getAccount(state, sourceId);

    // handle the SEP-41 transfer operation
    const parsed = tryParseSep41TransferInvoke(op, scope);
    if (parsed === null) {
      // Not a SEP-41 `transfer`; skip contract-token balance validation (other invokes ignore preloaded map).
      return;
    }

    const { fromAccountId, assetId, amount } = parsed;

    // safe guard to prevent the from account is different from the source account.
    if (fromAccountId !== sourceId) {
      throw new TransactionValidationException(
        'SEP-41 transfer requires the sender account to be the same as the source account',
      );
    }

    const sep41TokenBalanceMap = state.preloadedTokenBalance;
    const onChainBalance = sep41TokenBalanceMap?.get(
      toSep41TokenBalanceMapKey(sourceId, assetId),
    );
    if (onChainBalance === undefined) {
      throw new TransactionValidationException(
        'SEP-41 transfer requires a preloaded token balance for the sender and contract',
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
