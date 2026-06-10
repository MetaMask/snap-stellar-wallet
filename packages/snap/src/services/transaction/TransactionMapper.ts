import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import { TransactionType } from '@metamask/keyring-api';
import type { Operation } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';

import { StellarOperationType } from './api';
import { TransactionMapperException } from './exceptions';
import type {
  KeyringTransactionAsset,
  KeyringTransactionBuilder,
} from './KeyringTransactionBuilder';
import { KeyringTransactionType } from './KeyringTransactionBuilder';
import type { Transaction } from './Transaction';
import {
  isAddChangeTrustTransaction,
  isDustPaymentTransaction,
  isReceiveTransaction,
  isRemoveChangeTrustTransaction,
  isSendTransaction,
  isSwapTransaction,
  isReceiveOperation,
} from './utils';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  getSlip44AssetId,
  removeTrailingZeros,
  stellarAssetToCaip19,
  toDisplayBalance,
} from '../../utils';
import type { StellarKeyringAccount } from '../account/api';

export class TransactionMapper {
  readonly #keyringTransactionBuilder: KeyringTransactionBuilder;

  constructor({
    keyringTransactionBuilder,
  }: {
    keyringTransactionBuilder: KeyringTransactionBuilder;
  }) {
    this.#keyringTransactionBuilder = keyringTransactionBuilder;
  }

  mapTransaction({
    transaction,
    keyringAccount,
    transcationFromState,
  }: {
    transaction: Transaction;
    keyringAccount: StellarKeyringAccount;
    transcationFromState?: KeyringTransaction;
  }): KeyringTransaction | undefined {
    if (!transaction.rawData || !transaction.id) {
      throw new TransactionMapperException(
        'Transaction raw data or id is required, it looks like the transaction is not from a on-chain transaction record.',
      );
    }

    if (transcationFromState) {
      // In Stellar, if a transaction is still pending, it will not able to fetch.
      // Therefore, we are safe to assume when we get a onchain transaction, we can just update the status and fees.
      return this.#mapUpdatedTransaction(transaction, transcationFromState);
    }

    if (isDustPaymentTransaction(transaction, keyringAccount.address)) {
      return undefined; // Skip dust payment transactions.
    }

    return this.#mapTansaction(transaction, keyringAccount);
  }

  #mapTansaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): KeyringTransaction {
    const { address } = keyringAccount;

    // For any contract based transaction, we treat it as unknown.
    if (transaction.hasInvokeHostFunction) {
      return this.#mapUnknownTransaction(transaction, keyringAccount);
    }

    // Swap transaction: if the transaction has a path payment strict send operation
    // and sender and destination are the same address.
    if (isSwapTransaction(transaction, address)) {
      return this.#mapSwapTransaction(transaction, keyringAccount);
    }

    // Send transaction: if all operation are payment operations or create account operation.
    if (isSendTransaction(transaction, address)) {
      return this.#mapSendTransaction(transaction, keyringAccount);
    }

    // Add change trust transaction: if all operations are change trust operations and limit is MAX_INT64.
    if (isAddChangeTrustTransaction(transaction, address)) {
      return this.#mapChangeTrustTransaction(
        transaction,
        keyringAccount,
        KeyringTransactionType.ChangeTrustOptIn,
      );
    }

    // Remove change trust transaction: if all operations are change trust operations and limit is 0.
    if (isRemoveChangeTrustTransaction(transaction, address)) {
      return this.#mapChangeTrustTransaction(
        transaction,
        keyringAccount,
        KeyringTransactionType.ChangeTrustOptOut,
      );
    }

    if (isReceiveTransaction(transaction, address)) {
      return this.#mapReceiveTransaction(transaction, keyringAccount);
    }

    // TODO: add bridge send transaction
    // Fallback to unknown transaction if the transaction is not recognized.
    return this.#mapUnknownTransaction(transaction, keyringAccount);
  }

  #mapUpdatedTransaction(
    transaction: Transaction,
    transcationFromState: KeyringTransaction,
  ): KeyringTransaction {
    return {
      ...transcationFromState,
      fees: this.#getBaseFees(transaction),
      events: [
        ...transcationFromState.events,
        {
          status: transaction.status,
          timestamp: this.#getCreateTime(transaction),
        },
      ],
      status: transaction.status,
    };
  }

  #commonOnChainFields(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): {
    txId: string;
    account: StellarKeyringAccount;
    scope: KnownCaip2ChainId;
    status: Transaction['status'];
    fees: KeyringTransaction['fees'];
    timestamp: number;
  } {
    return {
      txId: transaction.id,
      account: keyringAccount,
      scope: transaction.scope,
      status: transaction.status,
      fees: this.#getBaseFees(transaction),
      timestamp: this.#getCreateTime(transaction),
    };
  }

  #getFirstSendOperationDetails(transaction: Transaction): {
    toAddress: string;
    asset: KeyringTransactionAsset;
  } | null {
    const { scope } = transaction;
    const [firstOperation] = transaction.transactionOperations;

    if (
      firstOperation &&
      firstOperation.type === StellarOperationType.Payment
    ) {
      const { destination: toAddress, asset, amount } = firstOperation;

      return {
        toAddress,
        asset: this.#assetToKeyringAssetRow(asset, scope, amount),
      };
    }

    if (
      firstOperation &&
      firstOperation.type === StellarOperationType.CreateAccount
    ) {
      return {
        toAddress: firstOperation.destination,
        asset: this.#assetToKeyringAssetRow(
          Asset.native(),
          scope,
          firstOperation.startingBalance,
        ),
      };
    }

    return null;
  }

  #mapSendTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): KeyringTransaction {
    // If there are multiple payment or create-account operations,
    // we only pick the first one for the send transaction details.
    const sendDetails = this.#getFirstSendOperationDetails(transaction);

    if (sendDetails) {
      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Send,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          ...sendDetails,
        },
      });
    }

    throw new TransactionMapperException('Unbale to map a send transaction');
  }

  #mapUnknownTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
    transactionType: TransactionType = TransactionType.Unknown,
  ): KeyringTransaction {
    return this.#keyringTransactionBuilder.createTransaction({
      type: KeyringTransactionType.Unknown,
      request: {
        ...this.#commonOnChainFields(transaction, keyringAccount),
        transactionType,
        from: [],
        to: [],
      },
    });
  }

  #mapSwapTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): KeyringTransaction {
    const swapOperation = transaction.transactionOperations.find(
      (operation) =>
        operation.type === StellarOperationType.PathPaymentStrictSend,
    );

    if (swapOperation) {
      const { scope } = transaction;
      const {
        destination: toAddress,
        sendAsset,
        destAsset,
        sendAmount,
        destMin,
      } = swapOperation;

      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Swap,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          toAddress,
          fromAsset: this.#assetToKeyringAssetRow(sendAsset, scope, sendAmount),
          toAsset: this.#assetToKeyringAssetRow(destAsset, scope, destMin),
        },
      });
    }

    throw new TransactionMapperException('Unbale to map a swap transaction');
  }

  #mapChangeTrustTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
    type:
      | KeyringTransactionType.ChangeTrustOptIn
      | KeyringTransactionType.ChangeTrustOptOut,
  ): KeyringTransaction {
    const operationTypes = transaction.transactionOperations;
    const { scope } = transaction;
    // If there are multiple change trust operations,
    // we only pick the first one for the activity details.
    const [firstOperation] = operationTypes;
    if (
      firstOperation &&
      firstOperation.type === StellarOperationType.ChangeTrust
    ) {
      const asset = firstOperation.line;
      if (!(asset instanceof Asset)) {
        throw new TransactionMapperException(
          `ChangeTrust line must be Stellar SAC Asset or Stellar Classic Asset`,
        );
      }

      return this.#keyringTransactionBuilder.createTransaction({
        type,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          asset: this.#assetToKeyringAssetRow(asset, scope, '0'),
        },
      });
    }
    throw new TransactionMapperException(
      'Unbale to map a change trust transaction',
    );
  }

  #mapReceiveTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): KeyringTransaction {
    // We normalize the receive operation assets and amounts to a single array.
    const [receiveAsset] = this.#extractReceiveOperationAssetAndAmount(
      transaction,
      keyringAccount.address,
      transaction.scope,
    );

    if (receiveAsset) {
      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Unknown,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          transactionType: TransactionType.Receive,
          from: [
            {
              // We assume the source account is the sender of the fund.
              address: transaction.sourceAccount,
              asset: receiveAsset,
            },
          ],
          to: [
            {
              address: keyringAccount.address,
              asset: receiveAsset,
            },
          ],
        },
      });
    }
    throw new TransactionMapperException('Unbale to map a receive transaction');
  }

  #getBaseFees(transaction: Transaction): KeyringTransaction['fees'] {
    return [
      {
        type: 'base',
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: getSlip44AssetId(transaction.scope),
          // Horizon returns the fee charged in the smallest unit of the asset.
          amount: toDisplayBalance(transaction.feeCharged),
          fungible: true,
        },
      },
    ];
  }

  #getCreateTime(transaction: Transaction): number {
    if (!transaction.rawData?.created_at) {
      return Math.floor(Date.now() / 1000); // seconds since epoch
    }
    // transaction.rawData?.created_at expected to be a UTC time string.
    return Math.floor(
      new Date(transaction.rawData?.created_at).getTime() / 1000,
    ); // seconds since epoch
  }

  #assetToKeyringAssetRow(
    asset: Asset,
    scope: KnownCaip2ChainId,
    amount: string,
  ): KeyringTransactionAsset {
    return {
      unit: asset.getCode(),
      type: stellarAssetToCaip19(asset, scope),
      // Horizon returns the amount with trailing zeros - "1.0000000" instead of "1".
      amount: removeTrailingZeros(amount),
      fungible: true as const,
    };
  }

  /**
   * Aggregates the assets and amounts credited by receive operations from a transaction.
   *
   * @param transaction - Stellar transaction to extract receive operation assets from.
   * @param accountAddress - Stellar address to check for incoming credits.
   * @param scope - CAIP-2 chain used to encode asset ids.
   * @returns Array of receive operation assets and amounts.
   */
  #extractReceiveOperationAssetAndAmount(
    transaction: Transaction,
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): KeyringTransactionAsset[] {
    const operationTypes = transaction.transactionOperations;
    const assetMap = new Map<
      KnownCaip19AssetIdOrSlip44Id,
      KeyringTransactionAsset
    >();

    operationTypes.forEach((operation) => {
      if (!isReceiveOperation(operation, accountAddress)) {
        return;
      }

      const receiveOperationAsset = this.#getReceiveOperationAsset(
        operation,
        scope,
      );
      if (!receiveOperationAsset) {
        return;
      }

      assetMap.set(receiveOperationAsset.type, receiveOperationAsset);
    });

    return Array.from(assetMap.values());
  }

  /**
   * Resolves the asset and amount credited by a receive operation.
   *
   * @param operation - Receive-capable operation (payment, create account, or path payment).
   * @param scope - CAIP-2 chain used to encode asset ids.
   * @returns Asset code, CAIP-19 id, and amount credited by the operation, or `null` when unsupported.
   */
  #getReceiveOperationAsset(
    operation: Operation,
    scope: KnownCaip2ChainId,
  ): KeyringTransactionAsset | null {
    if (operation.type === StellarOperationType.Payment) {
      return this.#assetToKeyringAssetRow(
        operation.asset,
        scope,
        operation.amount,
      );
    }

    if (operation.type === StellarOperationType.CreateAccount) {
      return this.#assetToKeyringAssetRow(
        Asset.native(),
        scope,
        operation.startingBalance,
      );
    }

    if (operation.type === StellarOperationType.PathPaymentStrictReceive) {
      return this.#assetToKeyringAssetRow(
        operation.destAsset,
        scope,
        operation.destAmount,
      );
    }

    if (operation.type === StellarOperationType.PathPaymentStrictSend) {
      return this.#assetToKeyringAssetRow(
        operation.sendAsset,
        scope,
        operation.sendAmount,
      );
    }

    return null;
  }
}
