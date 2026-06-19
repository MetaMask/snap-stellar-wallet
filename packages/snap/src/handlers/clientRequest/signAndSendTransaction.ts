import {
  FeeType,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import type { CaipAssetType } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';
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
import {
  KnownCaip19Slip44IdMap,
  type KnownCaip19AssetIdOrSlip44Id,
  type KnownCaip2ChainId,
} from '../../api';
import {
  type AccountResolver,
  type ResolvedActivatedAccount,
} from '../accountResolver';
import { BaseClientRequestHandler } from './base';
import { METAMASK_ORIGIN, NATIVE_ASSET_SYMBOL } from '../../constants';
import type { StellarKeyringAccount } from '../../services/account';
import type { AssetMetadataService } from '../../services/asset-metadata';
import { StellarOperationType } from '../../services/transaction/api';
import {
  KeyringTransactionType,
  type PendingTransactionRequest,
} from '../../services/transaction/KeyringTransactionBuilder';
import type { Transaction } from '../../services/transaction/Transaction';
import type { TransactionService } from '../../services/transaction/TransactionService';
import {
  isPaymentOperation,
  parseOperationAssetReference,
} from '../../services/transaction/utils';
import {
  isClassicAssetId,
  isSlip44Id,
  isStellarAssetId,
  parseClassicAssetCodeIssuer,
  toDisplayBalance,
} from '../../utils';
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

type SwapAssetIds = {
  sourceAssetId: CaipAssetType;
  destAssetId: CaipAssetType;
};

type DecodedSwapDetails = {
  sourceAddress: string;
  destinationAddress: string;
  sendAmount: string;
  receiveAmount: string;
  fromAsset: KeyringTransaction['from'][number]['asset'] | null;
  toAsset: KeyringTransaction['from'][number]['asset'] | null;
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

    const swapAssetIds = this.#getSwapAssetIds(options);

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
   * Reads the source and destination asset ids supplied by the multichain flow.
   *
   * @param options - The request options.
   * @returns The swap asset ids, or `null` when the flow did not supply them.
   */
  #getSwapAssetIds(
    options: SignAndSendTransactionJsonRpcRequest['params']['options'],
  ): SwapAssetIds | null {
    const { sourceAssetId, destAssetId } = options ?? {};
    if (sourceAssetId === undefined || destAssetId === undefined) {
      return null;
    }
    return { sourceAssetId, destAssetId };
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
    swapAssetIds: SwapAssetIds | null;
  }): Promise<void> {
    try {
      const request = await this.#createPendingTransactionRequest(params);

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

  async #createPendingTransactionRequest(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
    swapAssetIds: SwapAssetIds | null;
  }): Promise<PendingTransactionRequest> {
    const { transactionId, scope, account } = params;
    const swapDetails = await this.#createPendingSwapDetails(params);

    if (swapDetails !== null) {
      return { txId: transactionId, account, scope, ...swapDetails };
    }

    return {
      txId: transactionId,
      account,
      scope,
      asset: {
        type: KnownCaip19Slip44IdMap[scope],
        symbol: NATIVE_ASSET_SYMBOL,
      },
    };
  }

  /**
   * Builds the from/to/fees activity for a swap or bridge.
   *
   * Asset identities (`type` + `unit`) come from the client-supplied asset ids
   * (resolved through {@link AssetMetadataService} for Stellar assets), while
   * amounts and addresses are taken from the decoded path payment when present.
   *
   * @param params - The parameters.
   * @param params.transaction - The submitted Stellar transaction.
   * @param params.scope - The CAIP-2 chain id the transaction was submitted on.
   * @param params.account - The keyring account that submitted the transaction.
   * @param params.swapAssetIds - The source/destination asset ids, when supplied.
   * @returns The swap details, or `null` when there is nothing to describe.
   */
  async #createPendingSwapDetails(params: {
    transaction: Transaction;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    swapAssetIds: SwapAssetIds | null;
  }): Promise<PendingSwapDetails | null> {
    const { transaction, scope, account, swapAssetIds } = params;
    const decoded =
      this.#decodePathPaymentSwap(transaction, scope) ??
      (swapAssetIds ? this.#decodeBridgePayment(transaction, scope) : null);

    if (decoded === null && swapAssetIds === null) {
      return null;
    }

    const fromAsset = swapAssetIds
      ? await this.#resolveSwapAsset(
          swapAssetIds.sourceAssetId,
          decoded?.sendAmount ?? '0',
        )
      : (decoded?.fromAsset ?? null);
    const toAsset = swapAssetIds
      ? await this.#resolveSwapAsset(
          swapAssetIds.destAssetId,
          decoded?.receiveAmount ?? '0',
        )
      : (decoded?.toAsset ?? null);

    if (fromAsset === null || toAsset === null) {
      return null;
    }

    return {
      transactionType:
        swapAssetIds && this.#isCrossChain(swapAssetIds)
          ? TransactionType.BridgeSend
          : TransactionType.Swap,
      from: [
        {
          address: decoded?.sourceAddress ?? account.address,
          asset: fromAsset,
        },
      ],
      to: [
        {
          address: decoded?.destinationAddress ?? account.address,
          asset: toAsset,
        },
      ],
      fees: this.#createBaseFees(transaction, scope),
    };
  }

  /**
   * Builds a keyring asset from a client-supplied CAIP-19 asset id, resolving
   * the symbol via {@link AssetMetadataService} for Stellar assets and falling
   * back to the CAIP asset reference for assets on other chains.
   *
   * @param assetId - The CAIP-19 asset id.
   * @param amount - The asset amount.
   * @returns The keyring asset.
   */
  async #resolveSwapAsset(
    assetId: CaipAssetType,
    amount: string,
  ): Promise<KeyringTransaction['from'][number]['asset']> {
    const unit = await this.#resolveSwapAssetUnit(assetId);

    return {
      unit,
      type: assetId as KnownCaip19AssetIdOrSlip44Id,
      amount: new BigNumber(amount).toFixed(),
      fungible: true,
    };
  }

  async #resolveSwapAssetUnit(assetId: CaipAssetType): Promise<string> {
    if (!isStellarAssetId(assetId)) {
      return parseCaipAssetType(assetId).assetReference;
    }

    try {
      return (
        await this.#assetMetadataService.resolve(
          assetId as KnownCaip19AssetIdOrSlip44Id,
        )
      ).symbol;
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'Failed to resolve swap asset metadata; using fallback unit',
        { assetId, error },
      );
      return this.#getFallbackAssetUnit(assetId);
    }
  }

  #getFallbackAssetUnit(assetId: CaipAssetType): string {
    const { assetReference } = parseCaipAssetType(assetId);

    if (isSlip44Id(assetId)) {
      return NATIVE_ASSET_SYMBOL;
    }

    if (isClassicAssetId(assetId)) {
      return parseClassicAssetCodeIssuer(assetReference).assetCode;
    }

    return assetReference;
  }

  #decodePathPaymentSwap(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): DecodedSwapDetails | null {
    const operation = transaction.transactionOperations.find(
      (op) =>
        op.type === StellarOperationType.PathPaymentStrictSend ||
        op.type === StellarOperationType.PathPaymentStrictReceive,
    );

    if (operation === undefined) {
      return null;
    }

    const { sendAsset, sendAmount, destAsset, receiveAmount, destination } =
      operation.type === StellarOperationType.PathPaymentStrictSend
        ? {
            sendAsset: operation.sendAsset,
            sendAmount: operation.sendAmount,
            destAsset: operation.destAsset,
            receiveAmount: operation.destMin,
            destination: operation.destination,
          }
        : {
            sendAsset: operation.sendAsset,
            sendAmount: operation.sendMax,
            destAsset: operation.destAsset,
            receiveAmount: operation.destAmount,
            destination: operation.destination,
          };

    return {
      sourceAddress: operation.source ?? transaction.sourceAccount,
      destinationAddress: destination,
      sendAmount,
      receiveAmount,
      fromAsset: this.#keyringAssetFromStellarAsset(
        scope,
        sendAsset,
        sendAmount,
      ),
      toAsset: this.#keyringAssetFromStellarAsset(
        scope,
        destAsset,
        receiveAmount,
      ),
    };
  }

  #decodeBridgePayment(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): DecodedSwapDetails | null {
    const operation =
      transaction.transactionOperations.find(isPaymentOperation);

    if (operation === undefined) {
      return null;
    }

    return {
      sourceAddress: operation.source ?? transaction.sourceAccount,
      destinationAddress: operation.destination,
      sendAmount: operation.amount,
      receiveAmount: '0',
      fromAsset: this.#keyringAssetFromStellarAsset(
        scope,
        operation.asset,
        operation.amount,
      ),
      toAsset: null,
    };
  }

  #createBaseFees(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): KeyringTransaction['fees'] {
    return [
      {
        type: FeeType.Base,
        asset: {
          unit: NATIVE_ASSET_SYMBOL,
          type: KnownCaip19Slip44IdMap[scope],
          amount: toDisplayBalance(transaction.totalFee),
          fungible: true,
        },
      },
    ];
  }

  #keyringAssetFromStellarAsset(
    scope: KnownCaip2ChainId,
    asset: Asset,
    amount: string,
  ): KeyringTransaction['from'][number]['asset'] | null {
    const type = parseOperationAssetReference(scope, asset.toString());
    if (type === null) {
      return null;
    }

    return {
      unit: asset.isNative() ? NATIVE_ASSET_SYMBOL : asset.getCode(),
      type,
      amount: new BigNumber(amount).toFixed(),
      fungible: true,
    };
  }
}
