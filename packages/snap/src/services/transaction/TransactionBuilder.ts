import { parseCaipAssetType } from '@metamask/utils';
import type { xdr, OperationOptions } from '@stellar/stellar-sdk';
import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
  Operation,
  ScInt,
  TransactionBuilder as StellarSdkTransactionBuilder,
} from '@stellar/stellar-sdk';

import {
  InvalidAssetForCreateAccountException,
  TransactionBuilderException,
} from './exceptions';
import { Transaction } from './Transaction';
import { assertAssetScopeMatch, caip19ToStellarAsset } from './utils';
import type {
  KnownCaip2ChainId,
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19Sep41AssetId,
  KnownCaip19ClassicAssetId,
  KnownCaip19Slip44Id,
} from '../../api';
import { AppConfig } from '../../config';
import { BASE_FEE } from '../../constants';
import {
  createPrefixedLogger,
  type ILogger,
  isSep41Id,
  isSlip44Id,
  normalizeAmount,
  rethrowIfInstanceElseThrow,
} from '../../utils';
import { caip2ChainIdToNetwork } from '../network/utils';
import type { OnChainAccount } from '../on-chain-account/OnChainAccount';

/**
 * Builds Stellar transactions (e.g. change trust, create account) and rebuilds existing
 * transactions with an updated sequence. All methods return a {@link Transaction} wrapper.
 */
export class TransactionBuilder {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[💰 TransactionBuilder]');
  }

  /**
   * Builds a change-trust operation transaction for the given asset.
   *
   * @param params - Options object.
   * @param params.baseFee - The fee per operation.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - CAIP-19 asset id for the classic token asset.
   * @param params.onChainAccount - Source account (sequence and account id for the transaction).
   * @param params.limit - [optional] limit of the trustline.
   * @returns An unsigned transaction ready for signing.
   * @throws {TransactionBuilderException} If building fails.
   */
  changeTrust({
    baseFee,
    scope,
    assetId,
    onChainAccount,
    limit,
  }: {
    baseFee: string;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19ClassicAssetId;
    onChainAccount: OnChainAccount;
    limit?: string;
  }): Transaction {
    try {
      assertAssetScopeMatch(assetId, scope);

      const operationOpt: OperationOptions.ChangeTrust = {
        asset: caip19ToStellarAsset(assetId),
      };
      if (limit !== undefined) {
        operationOpt.limit = limit;
      }
      return this.#buildTransaction({
        onChainAccount,
        operations: [Operation.changeTrust(operationOpt)],
        timeout: this.#getTimeout(),
        scope,
        fee: baseFee,
      });
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to build change trust transaction',
        error,
      );
      throw new TransactionBuilderException(
        'Failed to build change trust transaction',
      );
    }
  }

  /**
   * Builds a single `invokeHostFunction` transaction calling SEP-41 `transfer(from, to, amount)`.
   * Amount must be in the token's smallest units (i128).
   *
   * @param params - Transfer build input.
   * @param params.scope - CAIP-2 chain id.
   * @param params.onChainAccount - Source account (sender is `onChainAccount.accountId`; sequence for the tx).
   * @param params.assetId - SEP-41 CAIP-19 asset id (contract reference in CAIP form).
   * @param params.destination - Recipient Stellar account id (`G…`).
   * @param params.amount - Amount in the token's smallest units (i128).
   * @returns Wrapped unsigned transaction with one `invokeHostFunction` op.
   */
  sep41Transfer(params: {
    scope: KnownCaip2ChainId;
    onChainAccount: OnChainAccount;
    assetId: KnownCaip19Sep41AssetId;
    destination: string;
    amount: BigNumber;
  }): Transaction {
    try {
      const { scope, onChainAccount, assetId, destination, amount } = params;
      assertAssetScopeMatch(assetId, scope);

      // If it is a SEP-41 asset, the asset reference is the token address
      const { assetReference: tokenAddress } = parseCaipAssetType(assetId);

      const token = new Contract(tokenAddress);
      // Contract token transfer function expects the amount in the token's smallest units (i128),
      // so we don't need to convert to human readable units here
      const amountScv = new ScInt(amount.toFixed(0), {
        type: 'i128',
      }).toScVal();
      const op = token.call(
        'transfer',
        Address.fromString(onChainAccount.accountId).toScVal(),
        Address.fromString(destination).toScVal(),
        amountScv,
      );

      return this.#buildTransaction({
        onChainAccount,
        operations: [op],
        timeout: this.#getTimeout(),
        scope,
        // Base fee is a placeholder until RPC simulation.
        fee: BASE_FEE.toString(),
      });
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to build sep41 transfer transaction',
        error,
      );
      throw new TransactionBuilderException(
        'Failed to build sep41 transfer transaction',
      );
    }
  }

  #send(params: {
    baseFee: string;
    scope: KnownCaip2ChainId;
    asset: KnownCaip19ClassicAssetId | KnownCaip19Slip44Id;
    onChainAccount: OnChainAccount;
    destination: string;
    amount: BigNumber;
  }): Transaction {
    const { amount, baseFee, scope, asset, onChainAccount, destination } =
      params;
    return this.#buildTransaction({
      onChainAccount,
      operations: [
        Operation.payment({
          asset: caip19ToStellarAsset(asset),
          amount: amount.toString(),
          destination,
        }),
      ],
      timeout: this.#getTimeout(),
      scope,
      fee: baseFee,
    });
  }

  #createAccount(params: {
    baseFee: string;
    scope: KnownCaip2ChainId;
    onChainAccount: OnChainAccount;
    destination: string;
    amount: BigNumber;
  }): Transaction {
    const { amount, baseFee, scope, onChainAccount, destination } = params;

    return this.#buildTransaction({
      onChainAccount,
      operations: [
        Operation.createAccount({
          startingBalance: amount.toString(),
          destination,
        }),
      ],
      timeout: this.#getTimeout(),
      scope,
      fee: baseFee,
    });
  }

  /**
   * Builds a transfer operation transaction for the given asset.
   * If the destination is not activated, a create account operation is added.
   * If the destination is activated, a payment operation is added.
   *
   * @param params - Options object.
   * @param params.onChainAccount - Source account (sequence and account id for the transaction).
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - Native (slip44), classic, or SEP-41 CAIP-19 asset id.
   * @param params.amount - Amount in the asset's smallest units (stroops for native/classic; token minor units for SEP-41).
   * @param params.destination - Recipient address and on-chain activation flag.
   * @param params.destination.address - Recipient Stellar account id (`G…`).
   * @param params.destination.isActivated - Whether the destination account exists and is funded on-chain.
   * @param params.baseFee - Base fee per operation in stroops.
   * @returns An unsigned transaction ready for signing.
   * @throws {InvalidAssetForCreateAccountException} When the destination is unfunded and the asset is not native.
   * @throws {TransactionBuilderException} If building fails.
   */
  transfer(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19AssetIdOrSlip44Id;
    amount: BigNumber;
    destination: {
      address: string;
      isActivated: boolean;
    };
    baseFee: BigNumber;
  }): Transaction {
    const { onChainAccount, scope, amount, assetId, destination, baseFee } =
      params;
    const { address: toAddress, isActivated } = destination;

    try {
      assertAssetScopeMatch(assetId, scope);

      if (isSep41Id(assetId)) {
        return this.sep41Transfer({
          scope,
          onChainAccount,
          assetId,
          destination: toAddress,
          amount,
        });
      }

      // Convert the amount to human readable units,
      // it is required for stellar classic assets transfer
      const normalizedAmount = normalizeAmount(amount);

      if (isActivated) {
        return this.#send({
          baseFee: baseFee.toString(),
          onChainAccount,
          scope,
          asset: assetId,
          destination: toAddress,
          amount: normalizedAmount,
        });
      }
      // Unfunded destination → createAccount only.
      if (!isSlip44Id(assetId)) {
        throw new InvalidAssetForCreateAccountException(assetId);
      }

      return this.#createAccount({
        baseFee: baseFee.toString(),
        onChainAccount,
        scope,
        amount: normalizedAmount,
        destination: toAddress,
      });
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to build transfer transaction',
        error,
      );

      if (error instanceof InvalidAssetForCreateAccountException) {
        throw error;
      }

      throw new TransactionBuilderException(
        'Failed to build transfer transaction',
      );
    }
  }

  /**
   * Deserializes a transaction from XDR.
   *
   * @param params - Options object.
   * @param params.xdr - The XDR string.
   * @param params.scope - The CAIP-2 chain ID.
   * @returns A transaction.
   * @throws {TransactionBuilderException} If deserializing fails.
   */
  deserialize(params: { xdr: string; scope: KnownCaip2ChainId }): Transaction {
    try {
      const { xdr, scope } = params;
      const decodedTransaction = StellarSdkTransactionBuilder.fromXDR(
        xdr,
        caip2ChainIdToNetwork(scope),
      );

      const transaction = new Transaction(decodedTransaction);

      return transaction;
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to deserialize transaction',
        error,
      );
      throw new TransactionBuilderException(
        'Failed to deserialize transaction',
      );
    }
  }

  /**
   * Rebuilds a transaction with a new sequence number (e.g. after `txBadSeq`).
   *
   * @param params - Options object.
   * @param params.transaction - The original transaction.
   * @param params.sequenceNumber - The new sequence number.
   * @returns A new transaction with updated sequence.
   * @throws {TransactionBuilderException} If rebuilding fails.
   */
  rebuildTxnWithNewSeq(params: {
    transaction: Transaction;
    sequenceNumber: string;
  }): Transaction {
    const { transaction, sequenceNumber } = params;
    try {
      const rawTransaction = transaction.getRaw();

      if (rawTransaction instanceof FeeBumpTransaction) {
        throw new TransactionBuilderException(
          'Rebuilding fee bump transactions is not supported',
        );
      }

      if (transaction.operationCount === 0) {
        throw new TransactionBuilderException('No operations in transaction');
      }

      // the initial fee passed to the builder gets scaled up based on the number
      // of operations at the end, so we have to down-scale first
      let fee = Math.floor(
        parseInt(rawTransaction.fee, 10) / rawTransaction.operations.length,
      );

      if (!Number.isFinite(fee) || fee <= 0) {
        this.#logger.warn(
          `Invalid fee amount, fallback to use fixed base fee value ${BASE_FEE}`,
        );
        fee = BASE_FEE;
      }

      // Minimal clone of the transaction
      const builder = new StellarSdkTransactionBuilder(
        new Account(transaction.sourceAccount, sequenceNumber),
        {
          fee: fee.toString(),
          memo: rawTransaction.memo,
          networkPassphrase: rawTransaction.networkPassphrase,
          timebounds: rawTransaction.timeBounds,
          ledgerbounds: rawTransaction.ledgerBounds,
          minAccountSequence: rawTransaction.minAccountSequence,
          minAccountSequenceAge: rawTransaction.minAccountSequenceAge,
          minAccountSequenceLedgerGap:
            rawTransaction.minAccountSequenceLedgerGap,
          // TODO: add extraSigners when cloning the envelope
        },
      );

      // Clone the transaction operations
      if ('tx' in rawTransaction) {
        const tx = rawTransaction.tx as xdr.Transaction;
        tx.operations().forEach((op) => builder.addOperation(op));
      } else {
        throw new TransactionBuilderException(
          'Failed to clone the transaction, it is not a compatible transaction',
        );
      }

      return new Transaction(builder.build());
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Failed to rebuild transaction', error);
      return rethrowIfInstanceElseThrow(
        error,
        [TransactionBuilderException],
        new TransactionBuilderException('Failed to rebuild transaction'),
      );
    }
  }

  #buildTransaction({
    onChainAccount,
    operations,
    timeout,
    scope,
    fee,
  }: {
    onChainAccount: OnChainAccount;
    operations: xdr.Operation[];
    timeout: number;
    scope: KnownCaip2ChainId;
    fee: string;
  }): Transaction {
    const accountInstance = new Account(
      onChainAccount.accountId,
      onChainAccount.sequenceNumber,
    );

    const networkPassphrase = caip2ChainIdToNetwork(scope);
    const builder = new StellarSdkTransactionBuilder(accountInstance, {
      fee,
      networkPassphrase,
    });

    for (const operation of operations) {
      builder.addOperation(operation);
    }

    const inner = builder.setTimeout(timeout).build();
    return new Transaction(inner);
  }

  #getTimeout(): number {
    return AppConfig.transaction.timeout;
  }
}
