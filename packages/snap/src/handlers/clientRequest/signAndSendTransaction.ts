import { TransactionType } from '@metamask/keyring-api';
import type { CaipAssetType } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';

import type {
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse,
} from './api';
import {
  SignAndSendTransactionJsonRpcRequestStruct,
  SignAndSendTransactionJsonRpcResponseStruct,
} from './api';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { BaseClientRequestHandler } from './base';
import { METAMASK_ORIGIN, STELLAR_DECIMAL_PLACES } from '../../constants';
import type { StellarKeyringAccount } from '../../services/account';
import type {
  AssetMetadataService,
  StellarAssetMetadata,
} from '../../services/asset-metadata';
import {
  getNativeAssetMetadata,
  toStellarAssetMetadata,
} from '../../services/asset-metadata/utils';
import { StellarOperationType } from '../../services/transaction/api';
import { KeyringTransactionType } from '../../services/transaction/KeyringTransactionBuilder';
import type { Transaction } from '../../services/transaction/Transaction';
import type { TransactionService } from '../../services/transaction/TransactionService';
import { isPathPaymentOperation } from '../../services/transaction/utils';
import {
  isClassicAssetId,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
  removeTrailingZeros,
  trackErrorIfNeeded,
} from '../../utils';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';
import { trackTransactionSubmitted } from '../../utils/snap';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

type SwapAssetIds = {
  sourceAssetId: KnownCaip19AssetIdOrSlip44Id;
  destAssetId: CaipAssetType;
};

export class SignAndSendTransactionHandler extends BaseClientRequestHandler<
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse
> {
  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  constructor({
    logger,
    accountResolver,
    transactionService,
    assetMetadataService,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    transactionService: TransactionService;
    assetMetadataService: AssetMetadataService;
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
    this.#assetMetadataService = assetMetadataService;
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

    const { sourceAssetId, destAssetId } = options;
    const swapAssetIds = { sourceAssetId, destAssetId };

    await this.#savePendingTransaction({
      transactionId: transactionHash,
      account,
      scope,
      transaction,
      swapAssetIds,
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
   * A swap is cross-chain when its source and destination assets live on
   * different chains (e.g. a Stellar asset bridged to an EVM asset).
   *
   * @param swapAssetIds - The source and destination asset ids.
   * @returns True when the two assets belong to different chains.
   */
  #isCrossChain(swapAssetIds: SwapAssetIds): boolean {
    const { chainId: sourceChainId } = parseCaipAssetType(
      swapAssetIds.sourceAssetId,
    );
    const { chainId: destChainId } = parseCaipAssetType(
      swapAssetIds.destAssetId,
    );
    return sourceChainId !== destChainId;
  }

  async #savePendingTransaction(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
    swapAssetIds: SwapAssetIds;
  }): Promise<void> {
    try {
      const { transactionId, scope, account, transaction, swapAssetIds } =
        params;
      if (this.#isCrossChain(swapAssetIds)) {
        await this.#transactionService.savePendingKeyringTransactionSafe({
          type: KeyringTransactionType.BridgeSend,
          request: {
            fees: this.#transactionService.keyringTransactionBuilder.getBaseFees(
              transaction.totalFee,
              scope,
            ),
            txId: transactionId,
            account,
            scope,
            transactionType: TransactionType.BridgeSend,
            // For cross-chain swaps, we don't have any from and to assets,
            // the client will map the assets based on the transaction Id.
            from: [],
            to: [],
          },
        });
      } else {
        // If it is a native swap, we can extract the send and dest amounts from the transaction.
        // For contract swaps, we will fallback to have sendAmount and destAmount to 0.
        const { sendAmount, destAmount } =
          this.#resolveSameChainSwapAmounts(transaction);

        const { sourceAssetMetadata, destAssetMetadata } =
          await this.#resolveSameChainSwapAssetIds(
            swapAssetIds.sourceAssetId,
            swapAssetIds.destAssetId as KnownCaip19AssetIdOrSlip44Id,
            scope,
          );

        await this.#transactionService.savePendingKeyringTransactionSafe({
          type: KeyringTransactionType.Swap,
          request: {
            fees: this.#transactionService.keyringTransactionBuilder.getBaseFees(
              transaction.totalFee,
              scope,
            ),
            txId: transactionId,
            account,
            scope,
            toAddress: account.address,
            fromAsset: {
              unit: sourceAssetMetadata.units[0].symbol,
              type: sourceAssetMetadata.assetId,
              amount: sendAmount,
              fungible: true,
            },
            toAsset: {
              unit: destAssetMetadata.units[0].symbol,
              type: destAssetMetadata.assetId,
              amount: destAmount,
              fungible: true,
            },
          },
        });
      }
    } catch (error) {
      await trackErrorIfNeeded(error);
      this.logger.warn('Failed to map a transaction for swap and bridge send', {
        error,
      });
    }
  }

  #resolveSameChainSwapAmounts(transaction: Transaction): {
    sendAmount: string;
    destAmount: string;
  } {
    // for any case we can detect if it is a swap transaction, we force the swap value to 0
    // E.g: Swap with contract, Swap with payment.
    let sendAmount = '0';
    let destAmount = '0';

    // In the Request Struct, we already ensure it map to our pattern,
    // Either it is using native swap, or it is using contract swap.
    // Contract swap will fallback to have sendAmount and destAmount to 0.
    const swapOperationIndex = transaction.transactionOperations.findIndex(
      (operation) => isPathPaymentOperation(operation),
    );
    if (swapOperationIndex >= 0) {
      const swapOperation =
        transaction.transactionOperations[swapOperationIndex];
      if (swapOperation && isPathPaymentOperation(swapOperation)) {
        // Extract the send/dest amount from the successful transaction result by the index of the swap operation.
        if (swapOperation.type === StellarOperationType.PathPaymentStrictSend) {
          destAmount = removeTrailingZeros(swapOperation.destMin);
          sendAmount = removeTrailingZeros(swapOperation.sendAmount);
        } else {
          destAmount = removeTrailingZeros(swapOperation.destAmount);
          sendAmount = removeTrailingZeros(swapOperation.sendMax);
        }
      }
    }

    return {
      sendAmount,
      destAmount,
    };
  }

  async #resolveSameChainSwapAssetIds(
    sourceAssetId: KnownCaip19AssetIdOrSlip44Id,
    destAssetId: KnownCaip19AssetIdOrSlip44Id,
    scope: KnownCaip2ChainId,
  ): Promise<{
    sourceAssetMetadata: StellarAssetMetadata;
    destAssetMetadata: StellarAssetMetadata;
  }> {
    const [sourceAssetMetadata, destAssetMetadata] = await Promise.all([
      this.#resolveAsset(sourceAssetId, scope),
      this.#resolveAsset(destAssetId, scope),
    ]);
    return {
      sourceAssetMetadata,
      destAssetMetadata,
    };
  }

  async #resolveAsset(
    assetId: KnownCaip19AssetIdOrSlip44Id,
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata> {
    if (isSlip44Id(assetId)) {
      return getNativeAssetMetadata(scope);
    } else if (isClassicAssetId(assetId)) {
      const { assetReference } = parseCaipAssetType(assetId);
      const { assetCode } = parseClassicAssetCodeIssuer(assetReference);
      return toStellarAssetMetadata({
        assetId,
        decimals: STELLAR_DECIMAL_PLACES,
        symbol: assetCode,
        name: assetCode,
      });
    }
    try {
      return await this.#assetMetadataService.resolve(assetId);
    } catch (error) {
      this.logger.warn(
        'Failed to resolve asset metadata; using fallback symbol',
        { assetId, error },
      );
      const { assetReference } = parseCaipAssetType(assetId);
      return toStellarAssetMetadata({
        assetId,
        decimals: STELLAR_DECIMAL_PLACES,
        symbol: assetReference,
        name: assetReference,
      });
    }
  }
}
