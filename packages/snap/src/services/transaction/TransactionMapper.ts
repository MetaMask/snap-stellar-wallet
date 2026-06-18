import type { Transaction as KeyringTransaction } from '@metamask/keyring-api';
import { TransactionStatus, TransactionType } from '@metamask/keyring-api';
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
  isPathPaymentOperation,
  isInvokeHostFunctionOperation,
} from './utils';
import type { SuccessfulTransactionResult } from './xdrParser';
import {
  parseSep41TransferInvokeSafe,
  parseSuccessfulTransactionResult,
  TransactionResultType,
} from './xdrParser';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  getSlip44AssetId,
  removeTrailingZeros,
  stellarAssetToCaip19,
  toDisplayBalance,
} from '../../utils';
import type { StellarKeyringAccount } from '../account/api';
import type { StellarAssetMetadata } from '../asset-metadata';

export class TransactionMapper {
  readonly #keyringTransactionBuilder: KeyringTransactionBuilder;

  readonly #logger: ILogger;

  constructor({
    keyringTransactionBuilder,
    logger,
  }: {
    keyringTransactionBuilder: KeyringTransactionBuilder;
    logger: ILogger;
  }) {
    this.#keyringTransactionBuilder = keyringTransactionBuilder;
    this.#logger = createPrefixedLogger(logger, '[💰 TransactionMapper]');
  }

  /**
   * Maps an on-chain transaction to a keyring transaction without throwing.
   *
   * @param params - Mapping input.
   * @param params.transaction - Horizon-sourced transaction to map.
   * @param params.keyringAccount - Account that owns the activity.
   * @param params.transactionFromState - Existing pending transaction to reconcile.
   * @param params.assetMetadata - SEP-41 asset metadata keyed by CAIP-19 id for send mapping.
   * @returns Mapped keyring transaction, or `undefined` when skipped or unmappable.
   */
  mapTransactionSafe(params: {
    transaction: Transaction;
    keyringAccount: StellarKeyringAccount;
    assetMetadata: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>;
    transactionFromState?: KeyringTransaction;
  }): KeyringTransaction | undefined {
    const { transaction, keyringAccount, assetMetadata, transactionFromState } =
      params;

    try {
      if (!transaction.rawData || !transaction.id) {
        throw new TransactionMapperException(
          'Transaction raw data and id are required; this transaction does not appear to be sourced from an on-chain transaction record',
        );
      }

      if (transactionFromState) {
        // Pending txs are not on Horizon until confirmed; once on-chain data exists,
        // preserve the existing keyring transaction and only refresh status and fees.
        return this.#mapUpdatedTransaction(transaction, transactionFromState);
      }

      if (isDustPaymentTransaction(transaction, keyringAccount.address)) {
        return undefined; // Skip dust payment transactions.
      }

      return this.#mapTransaction(transaction, keyringAccount, assetMetadata);
    } catch (error) {
      // Log and return undefined so batch mapping can continue for other transactions.
      this.#logger.logErrorWithDetails('Unable to map a transaction', {
        error,
        transactionId: transaction.id,
      });
      return undefined;
    }
  }

  #mapTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
    assetMetadata: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>,
  ): KeyringTransaction | undefined {
    const { address } = keyringAccount;

    if (transaction.hasInvokeHostFunction && transaction.operationCount === 1) {
      // Invoke host function: try SEP-41 send mapping first; fall back to unknown.
      return (
        this.#mapSep41SendTransaction(
          transaction,
          keyringAccount,
          assetMetadata,
        ) ?? this.#mapUnknownTransaction(transaction, keyringAccount)
      );
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

    // Change-trust opt-in: all operations are change trust with non-zero limit.
    if (isAddChangeTrustTransaction(transaction, address)) {
      return this.#mapChangeTrustTransaction(
        transaction,
        keyringAccount,
        KeyringTransactionType.ChangeTrustOptIn,
      );
    }

    // Change-trust opt-out: all operations are change trust with zero limit.
    if (isRemoveChangeTrustTransaction(transaction, address)) {
      return this.#mapChangeTrustTransaction(
        transaction,
        keyringAccount,
        KeyringTransactionType.ChangeTrustOptOut,
      );
    }

    // Incoming credit from any source (payment, create account, or path payment).
    // Self-swap and self-send are already handled above.
    if (isReceiveTransaction(transaction, address)) {
      return this.#mapReceiveTransaction(transaction, keyringAccount);
    }

    // TODO: add bridge send transaction
    // Unrecognized shape; surface as unknown activity.
    return this.#mapUnknownTransaction(transaction, keyringAccount);
  }

  #mapUpdatedTransaction(
    transaction: Transaction,
    transactionFromState: KeyringTransaction,
  ): KeyringTransaction {
    return {
      ...transactionFromState,
      fees: this.#getBaseFees(transaction),
      events: [
        ...transactionFromState.events,
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
    // Multi-op sends only expose the first payment or create-account operation.
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

    throw new TransactionMapperException('Unable to map a send transaction');
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
    // Find the index of the swap operation as the key to look up the destination amount in the successful transaction result.
    const swapOperationIndex = transaction.transactionOperations.findIndex(
      (operation) => isPathPaymentOperation(operation),
    );
    const swapOperation = transaction.transactionOperations[swapOperationIndex];

    if (swapOperation && isPathPaymentOperation(swapOperation)) {
      const { scope } = transaction;

      const successfulTransactionResult =
        this.#getSuccessfulTransactionResultSafe(transaction);

      const { destination: toAddress, sendAsset, destAsset } = swapOperation;

      let sendAmount;
      let destAmount;

      // Extract the send/dest amount from the successful transaction result by the index of the swap operation.
      if (swapOperation.type === StellarOperationType.PathPaymentStrictSend) {
        destAmount =
          this.#extractSwapDestOrSourceAmount(
            successfulTransactionResult,
            swapOperationIndex,
          ) ?? swapOperation.destMin;
        sendAmount = swapOperation.sendAmount;
      } else {
        destAmount = swapOperation.destAmount;
        sendAmount =
          this.#extractSwapDestOrSourceAmount(
            successfulTransactionResult,
            swapOperationIndex,
          ) ?? swapOperation.sendMax;
      }

      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Swap,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          toAddress,
          fromAsset: this.#assetToKeyringAssetRow(sendAsset, scope, sendAmount),
          toAsset: this.#assetToKeyringAssetRow(destAsset, scope, destAmount),
        },
      });
    }

    throw new TransactionMapperException('Unable to map a swap transaction');
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
    // Multi-op change-trust only exposes the first operation.
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
      'Unable to map a change trust transaction',
    );
  }

  #mapReceiveTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
  ): KeyringTransaction | undefined {
    // Skip failed transactions for receive mapping.
    if (transaction.status === TransactionStatus.Failed) {
      return undefined;
    }

    // Use the first deduplicated receive asset (by CAIP-19 id).
    const [receiveAsset] = this.#extractReceiveOperationAssetAndAmount(
      transaction,
      keyringAccount.address,
    );

    if (receiveAsset) {
      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Unknown,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          transactionType: TransactionType.Receive,
          from: [
            {
              // Transaction source account is treated as the sender.
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
    throw new TransactionMapperException('Unable to map a receive transaction');
  }

  #mapSep41SendTransaction(
    transaction: Transaction,
    keyringAccount: StellarKeyringAccount,
    assetMetadata: Record<KnownCaip19Sep41AssetId, StellarAssetMetadata>,
  ): KeyringTransaction | undefined {
    try {
      const { scope } = transaction;
      const [firstOperation] = transaction.transactionOperations;

      if (!isInvokeHostFunctionOperation(firstOperation)) {
        return undefined;
      }

      const parsedSep41TransferInvoke = parseSep41TransferInvokeSafe(
        firstOperation,
        scope,
      );

      if (!parsedSep41TransferInvoke) {
        return undefined;
      }

      const { assetId, amount, toAccountId, fromAccountId } =
        parsedSep41TransferInvoke;

      if (fromAccountId !== keyringAccount.address) {
        return undefined;
      }

      // TODO: Fall back to NetworkService token metadata when state is missing (RPC cost per tx).
      const asset = assetMetadata[assetId];
      if (!asset) {
        return undefined;
      }

      const assetRow = this.#toKeyringAssetRow(
        asset.symbol,
        asset.assetId,
        toDisplayBalance(amount, asset.units[0].decimals),
      );
      return this.#keyringTransactionBuilder.createTransaction({
        type: KeyringTransactionType.Send,
        request: {
          ...this.#commonOnChainFields(transaction, keyringAccount),
          asset: assetRow,
          toAddress: toAccountId,
        },
      });
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Unable to map a SEP-41 send transaction',
        {
          error,
        },
      );
      return undefined;
    }
  }

  #getBaseFees(transaction: Transaction): KeyringTransaction['fees'] {
    return [
      {
        type: 'base',
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: getSlip44AssetId(transaction.scope),
          // Horizon reports fee_charged in stroops (smallest XLM unit).
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
    // Horizon `created_at` is a UTC ISO-8601 string.
    return Math.floor(
      new Date(transaction.rawData?.created_at).getTime() / 1000,
    ); // seconds since epoch
  }

  #assetToKeyringAssetRow(
    asset: Asset,
    scope: KnownCaip2ChainId,
    amount: string,
  ): KeyringTransactionAsset {
    return this.#toKeyringAssetRow(
      asset.getCode(),
      stellarAssetToCaip19(asset, scope),
      amount,
    );
  }

  #toKeyringAssetRow(
    unit: string,
    type: KnownCaip19AssetIdOrSlip44Id,
    amount: string,
  ): KeyringTransactionAsset {
    return {
      unit,
      type,
      // Normalize Horizon amounts such as "1.0000000" to "1".
      amount: removeTrailingZeros(amount),
      fungible: true as const,
    };
  }

  /**
   * Collects unique assets credited by receive operations (deduplicated by CAIP-19 id).
   *
   * @param transaction - Stellar transaction to extract receive operation assets from.
   * @param accountAddress - Stellar address to check for incoming credits.
   * @returns Deduplicated receive-operation assets (amounts are not summed when multiple operations credit the same asset).
   */
  #extractReceiveOperationAssetAndAmount(
    transaction: Transaction,
    accountAddress: string,
  ): KeyringTransactionAsset[] {
    const operationTypes = transaction.transactionOperations;
    const assetMap = new Map<
      KnownCaip19AssetIdOrSlip44Id,
      KeyringTransactionAsset
    >();

    // Parse the successful transaction result first to avoid parsing per operation.
    const successfulTransactionResult =
      this.#getSuccessfulTransactionResultSafe(transaction);

    operationTypes.forEach((operation, index) => {
      if (!isReceiveOperation(operation, accountAddress)) {
        return;
      }

      const receiveOperationAsset = this.#getReceiveOperationAssetSafe(
        transaction,
        successfulTransactionResult,
        index,
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
   * @param transaction - Stellar transaction containing the receive operation.
   * @param successfulTransactionResult - Successful transaction result to extract the destination amount from.
   * @param index - Index of the receive operation within the transaction.
   * @returns Asset code, CAIP-19 id, and amount credited by the operation, or `null` when unsupported.
   */
  #getReceiveOperationAssetSafe(
    transaction: Transaction,
    successfulTransactionResult: SuccessfulTransactionResult | null,
    index: number,
  ): KeyringTransactionAsset | null {
    try {
      const { scope } = transaction;
      const operation = transaction.transactionOperations[index];
      if (!operation) {
        return null;
      }

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
        const destAmount =
          this.#extractSwapDestOrSourceAmount(
            successfulTransactionResult,
            index,
          ) ?? operation.destMin;

        return this.#assetToKeyringAssetRow(
          operation.destAsset,
          scope,
          destAmount,
        );
      }
    } catch {
      // Skip unsupported or unparseable operations; keep collecting other receive assets.
      return null;
    }

    return null;
  }

  #getSuccessfulTransactionResultSafe(
    transaction: Transaction,
  ): SuccessfulTransactionResult | null {
    try {
      if (!transaction.rawData?.result_xdr) {
        return null;
      }

      const successfulTransactionResult = parseSuccessfulTransactionResult(
        transaction.rawData?.result_xdr,
        transaction.scope,
      );

      // There is no partically successful transaction result, so the successful transaction result either 0 or match the number of operations as the transaction.
      if (
        successfulTransactionResult?.operationResults.length !==
        transaction.transactionOperations.length
      ) {
        return null;
      }

      return successfulTransactionResult;
    } catch {
      return null;
    }
  }

  #extractSwapDestOrSourceAmount(
    successfulTransactionResult: SuccessfulTransactionResult | null,
    index: number,
  ): string | null {
    const result = successfulTransactionResult?.operationResults[index];

    if (
      result &&
      (result?.type === TransactionResultType.PathPaymentStrictSendSuccess ||
        result?.type ===
          TransactionResultType.PathPaymentStrictReceiveSuccess) &&
      result?.amount !== undefined
    ) {
      return result.amount;
    }
    return null;
  }
}
