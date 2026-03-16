import type {
  xdr,
  Transaction as StellarSdkTransaction,
} from '@stellar/stellar-sdk';
import {
  Account,
  Operation,
  TransactionBuilder as StellarSdkTransactionBuilder,
  BASE_FEE,
} from '@stellar/stellar-sdk';

import type { LoadedAccount } from './api';
import { TransactionBuilderException } from './exceptions';
import { Transaction } from './Transaction';
import { getNetwork, getStellarAsset } from './utils';
import type { Wallet } from './Wallet';
import type { KnownCaip2ChainId, KnownCaip19AssetId } from '../../api';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';

/**
 * Builds Stellar transactions (e.g. change trust, create account) and rebuilds existing
 * transactions with updated source/sequence/fee. All methods return a {@link Transaction} wrapper.
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
   * @param params.asset - The asset code or full asset string (e.g. "CODE:ISSUER").
   * @param params.account - The wallet to use as the transaction source.
   * @returns An unsigned transaction ready for signing.
   * @throws {TransactionBuilderException} If building fails.
   */
  changeTrust(params: {
    baseFee: string;
    scope: KnownCaip2ChainId;
    asset: KnownCaip19AssetId;
    account: Wallet;
  }): Transaction {
    const { baseFee, scope, asset, account } = params;

    try {
      return this.#buildTransaction({
        account,
        operations: [
          Operation.changeTrust({
            asset: getStellarAsset(asset),
          }),
        ],
        timeout: 180,
        scope,
        fee: baseFee,
      });
    } catch (error: unknown) {
      this.#logger.debugError(
        'Failed to build change trust transaction',
        error,
      );
      throw new TransactionBuilderException(
        'Failed to build change trust transaction',
      );
    }
  }

  /**
   * Clones a transaction and updates the source account and sequence.
   *
   * @param params - Options object.
   * @param params.transaction - The original transaction.
   * @param params.account - The loaded account with latest sequence.
   * @param params.baseFee - [optional] The base fee to use for the transaction; if omitted, the original fee is used.
   * @returns A new transaction with updated source.
   * @throws {TransactionBuilderException} If rebuilding fails.
   */
  rebuildTransaction(params: {
    transaction: Transaction;
    account: LoadedAccount;
    baseFee?: string;
  }): Transaction {
    const { transaction, account, baseFee } = params;
    try {
      const rawTransaction =
        transaction.getRaw() as unknown as StellarSdkTransaction;

      // the initial fee passed to the builder gets scaled up based on the number
      // of operations at the end, so we have to down-scale first
      const unscaledFee = Math.floor(
        parseInt(rawTransaction.fee, 10) / rawTransaction.operations.length,
      );

      // Minimal clone of the transaction
      const builder = new StellarSdkTransactionBuilder(
        new Account(account.accountId(), account.sequenceNumber()),
        {
          fee: (baseFee ?? unscaledFee ?? BASE_FEE).toString(),
          networkPassphrase: rawTransaction.networkPassphrase,
          timebounds: rawTransaction.timeBounds,
        },
      );

      // Clone the transaction operations
      if ('tx' in rawTransaction) {
        const tx = rawTransaction.tx as xdr.Transaction;
        tx.operations().forEach((op) => builder.addOperation(op));
      } else {
        throw new Error('Transaction is not a compatible transaction');
      }

      return new Transaction(builder.build());
    } catch (error: unknown) {
      this.#logger.debugError('Failed to rebuild transaction', error);
      throw new TransactionBuilderException('Failed to rebuild transaction');
    }
  }

  #buildTransaction({
    account,
    operations,
    timeout,
    scope,
    fee,
  }: {
    account: Wallet;
    operations: xdr.Operation[];
    timeout: number;
    scope: KnownCaip2ChainId;
    fee: string;
  }): Transaction {
    const accountInstance = new Account(
      account.account.accountId(),
      account.account.sequenceNumber(),
    );

    const networkPassphrase = getNetwork(scope);
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
}
