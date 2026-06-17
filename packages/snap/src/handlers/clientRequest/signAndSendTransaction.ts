import {
  FeeType,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import type { Asset } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type {
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse,
} from './api';
import {
  SignAndSendTransactionJsonRpcRequestStruct,
  SignAndSendTransactionJsonRpcResponseStruct,
} from './api';
import { KnownCaip19Slip44IdMap, type KnownCaip2ChainId } from '../../api';
import {
  type AccountResolver,
  type ResolvedActivatedAccount,
} from '../accountResolver';
import { BaseClientRequestHandler } from './base';
import { METAMASK_ORIGIN, NATIVE_ASSET_SYMBOL } from '../../constants';
import type { StellarKeyringAccount } from '../../services/account';
import { StellarOperationType } from '../../services/transaction/api';
import {
  KeyringTransactionType,
  type PendingTransactionRequest,
} from '../../services/transaction/KeyringTransactionBuilder';
import type { Transaction } from '../../services/transaction/Transaction';
import type { TransactionService } from '../../services/transaction/TransactionService';
import { parseOperationAssetReference } from '../../services/transaction/utils';
import { toDisplayBalance } from '../../utils/currency';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';
import { trackTransactionSubmitted } from '../../utils/snap';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

type PendingSwapDetails = {
  transactionType: TransactionType;
  from: KeyringTransaction['from'];
  to: KeyringTransaction['to'];
  fees: KeyringTransaction['fees'];
};

export class SignAndSendTransactionHandler extends BaseClientRequestHandler<
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse
> {
  readonly #transactionService: TransactionService;

  constructor({
    logger,
    accountResolver,
    transactionService,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    transactionService: TransactionService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[👋 SignAndSendTransactionHandler]',
    );
    super({
      accountResolver,
      logger: prefixedLogger,
      requestStruct: SignAndSendTransactionJsonRpcRequestStruct,
      responseStruct: SignAndSendTransactionJsonRpcResponseStruct,
    });
    this.#transactionService = transactionService;
  }

  /**
   * Signs and submits the envelope built by MetaMask CrossChain API and quoted by {@link ComputeFeeHandler}.
   *
   * Use the **same** `params.transaction` and `params.scope` as **computeFee** so the signed submission
   * matches the quoted envelope. The user must remain the transaction source. Decoding and validation
   * use {@link TransactionService.createValidatedSwapTransaction}.
   *
   * CRITICAL SECURITY REQUIREMENT:
   * This method does NOT request user confirmation. The caller is responsible
   * for obtaining explicit user consent before invoking this method.
   *
   * The caller MUST:
   * - Display transaction details (recipient, amount, fees) to the user
   * - Obtain explicit user approval before calling this method
   * - Validate transaction authenticity and integrity
   *
   * Failure to implement caller-side consent will result in transactions being
   * signed and broadcast without user knowledge, creating a critical security
   * vulnerability.
   *
   * @param resolved - The resolved and activated account and wallet ({@link ResolvedActivatedAccount}).
   * @param request - The JSON-RPC request containing transaction details.
   * @param request.params.transaction - The Base64 encoded XDR of the transaction.
   * @param request.params.scope - The CAIP-2 chain ID.
   * @returns A promise that resolves to the JSON-RPC response ({@link SignAndSendTransactionJsonRpcResponse}).
   */
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: SignAndSendTransactionJsonRpcRequest,
  ): Promise<SignAndSendTransactionJsonRpcResponse> {
    const { wallet, onChainAccount, account } = resolved;
    const {
      transaction: transactionBase64Xdr,
      scope,
      options,
    } = request.params;

    const transaction =
      await this.#transactionService.createValidatedSwapTransaction({
        xdr: transactionBase64Xdr,
        scope,
        onChainAccount,
      });

    wallet.signTransaction(transaction);

    const transactionHash = await this.#transactionService.sendTransaction({
      wallet,
      onChainAccount,
      scope,
      transaction,
      pollTransaction: false,
    });

    await trackTransactionSubmitted({
      origin: METAMASK_ORIGIN,
      accountType: account.type,
      chainIdCaip: scope,
    });

    await this.#savePendingTransaction({
      transactionId: transactionHash,
      account,
      scope,
      transaction,
      isCrossChain: this.#isCrossChainBridge(scope, options),
    });

    // Schedule the track-transaction background event.
    await TrackTransactionHandler.scheduleBackgroundEvent({
      scope,
      txId: transactionHash,
      // Same-chain swaps reuse the sender address as the receiver; cross-chain swaps
      // use a non-Stellar receiver, so only the sender account id is tracked.
      accountIdsOrAddresses: [account.id],
    });

    return {
      transactionId: transactionHash,
    };
  }

  /**
   * Determines whether the submitted transaction is a cross-chain bridge based on
   * the source and destination chain metadata supplied by the client.
   *
   * @param scope - The CAIP-2 chain id the transaction is submitted on (the source chain).
   * @param options - The request options, optionally carrying `sourceChainId` and `destChainId`.
   * @returns True when a destination chain is provided and differs from the source chain.
   */
  #isCrossChainBridge(
    scope: KnownCaip2ChainId,
    options: SignAndSendTransactionJsonRpcRequest['params']['options'],
  ): boolean {
    const destChainId = options?.destChainId;
    if (destChainId === undefined) {
      return false;
    }
    const sourceChainId = options?.sourceChainId ?? scope;
    return sourceChainId !== destChainId;
  }

  async #savePendingTransaction(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
    isCrossChain: boolean;
  }): Promise<void> {
    try {
      const { transactionId, scope, account, transaction, isCrossChain } =
        params;
      const request = this.#createPendingTransactionRequest({
        transactionId,
        scope,
        account,
        transaction,
        isCrossChain,
      });

      await this.#transactionService.savePendingKeyringTransaction({
        type: KeyringTransactionType.Pending,
        request,
      });
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'Failed to save pending transaction',
        error,
      );
      // Do not throw here; continue even if the pending transaction was not saved.
    }
  }

  #createPendingTransactionRequest(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
    isCrossChain: boolean;
  }): PendingTransactionRequest {
    const { transactionId, scope, account, transaction, isCrossChain } = params;
    const swapDetails = this.#createPendingSwapDetails(
      transaction,
      scope,
      isCrossChain,
    );

    if (swapDetails !== null) {
      return {
        txId: transactionId,
        account,
        scope,
        ...swapDetails,
      };
    }

    return {
      txId: transactionId,
      account,
      scope,
      // Mark undecoded cross-chain transactions as bridge sends so the activity
      // history does not surface them as a generic unknown transaction.
      ...(isCrossChain && { transactionType: TransactionType.BridgeSend }),
      asset: {
        type: KnownCaip19Slip44IdMap[scope],
        symbol: NATIVE_ASSET_SYMBOL,
      },
    };
  }

  #createPendingSwapDetails(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
    isCrossChain: boolean,
  ): PendingSwapDetails | null {
    const pathPaymentOperation = transaction.transactionOperations.find(
      (operation) =>
        operation.type === StellarOperationType.PathPaymentStrictSend ||
        operation.type === StellarOperationType.PathPaymentStrictReceive,
    );

    if (pathPaymentOperation === undefined) {
      return null;
    }

    const sourceAddress =
      pathPaymentOperation.source ?? transaction.sourceAccount;
    const send =
      pathPaymentOperation.type === StellarOperationType.PathPaymentStrictSend
        ? {
            asset: pathPaymentOperation.sendAsset,
            amount: pathPaymentOperation.sendAmount,
          }
        : {
            asset: pathPaymentOperation.sendAsset,
            amount: pathPaymentOperation.sendMax,
          };
    const receive =
      pathPaymentOperation.type === StellarOperationType.PathPaymentStrictSend
        ? {
            asset: pathPaymentOperation.destAsset,
            amount: pathPaymentOperation.destMin,
          }
        : {
            asset: pathPaymentOperation.destAsset,
            amount: pathPaymentOperation.destAmount,
          };
    const fromAsset = this.#createKeyringAsset(scope, send.asset, send.amount);
    const toAsset = this.#createKeyringAsset(
      scope,
      receive.asset,
      receive.amount,
    );

    if (fromAsset === null || toAsset === null) {
      return null;
    }

    return {
      transactionType: isCrossChain
        ? TransactionType.BridgeSend
        : TransactionType.Swap,
      from: [
        {
          address: sourceAddress,
          asset: fromAsset,
        },
      ],
      to: [
        {
          address: pathPaymentOperation.destination,
          asset: toAsset,
        },
      ],
      fees: [
        {
          type: FeeType.Base,
          asset: {
            unit: NATIVE_ASSET_SYMBOL,
            type: KnownCaip19Slip44IdMap[scope],
            amount: toDisplayBalance(transaction.totalFee),
            fungible: true,
          },
        },
      ],
    };
  }

  #createKeyringAsset(
    scope: KnownCaip2ChainId,
    asset: Asset,
    amount: string,
  ): KeyringTransaction['from'][number]['asset'] | null {
    const type = parseOperationAssetReference(scope, asset.toString());
    if (type === null) {
      return null;
    }

    return {
      unit: this.#getAssetSymbol(asset),
      type,
      amount: new BigNumber(amount).toFixed(),
      fungible: true,
    };
  }

  #getAssetSymbol(asset: Asset): string {
    return asset.isNative() ? NATIVE_ASSET_SYMBOL : asset.getCode();
  }
}
