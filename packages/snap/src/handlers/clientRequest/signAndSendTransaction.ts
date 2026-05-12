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
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import {
  KeyringTransactionType,
  type PendingTransactionRequest,
} from '../../services/transaction/KeyringTransactionBuilder';
import type { Transaction } from '../../services/transaction/Transaction';
import type { TransactionService } from '../../services/transaction/TransactionService';
import { parseOperationAssetReference } from '../../services/transaction/utils';
import type { WalletService } from '../../services/wallet';
import { toDisplayBalance } from '../../utils/currency';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

type PendingSwapDetails = {
  transactionType: TransactionType;
  from: KeyringTransaction['from'];
  to: KeyringTransaction['to'];
  fees: KeyringTransaction['fees'];
};

export class SignAndSendTransactionHandler extends WithClientRequestActiveAccountResolve<
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse
> {
  readonly #transactionService: TransactionService;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    transactionService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
    transactionService: TransactionService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[👋 SignAndSendTransactionHandler]',
    );
    super({
      accountService,
      onChainAccountService,
      walletService,
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
  async _handle(
    resolved: ResolvedActivatedAccount,
    request: SignAndSendTransactionJsonRpcRequest,
  ): Promise<SignAndSendTransactionJsonRpcResponse> {
    const { wallet, onChainAccount, account } = resolved;
    const { transaction: transactionBase64Xdr, scope } = request.params;

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

    await this.#savePendingTransaction({
      transactionId: transactionHash,
      account,
      scope,
      transaction,
    });

    // Track the transaction after a transaction
    await TrackTransactionHandler.scheduleBackgroundEvent({
      scope,
      txId: transactionHash,
      accountIds: [account.id],
    });

    return {
      transactionId: transactionHash,
    };
  }

  async #savePendingTransaction(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
  }): Promise<void> {
    try {
      const { transactionId, scope, account, transaction } = params;
      const request = this.#createPendingTransactionRequest({
        transactionId,
        scope,
        account,
        transaction,
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
      // we should not throw error here, as we want to continue the flow even if the pending transaction is not saved
    }
  }

  #createPendingTransactionRequest(params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
    transaction: Transaction;
  }): PendingTransactionRequest {
    const { transactionId, scope, account, transaction } = params;
    const swapDetails = this.#createPendingSwapDetails(transaction, scope);

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
      asset: {
        type: KnownCaip19Slip44IdMap[scope],
        symbol: NATIVE_ASSET_SYMBOL,
      },
    };
  }

  #createPendingSwapDetails(
    transaction: Transaction,
    scope: KnownCaip2ChainId,
  ): PendingSwapDetails | null {
    const pathPaymentOperation = transaction.transactionOperations.find(
      (operation) =>
        operation.type === 'pathPaymentStrictSend' ||
        operation.type === 'pathPaymentStrictReceive',
    );

    if (pathPaymentOperation === undefined) {
      return null;
    }

    const sourceAddress =
      pathPaymentOperation.source ?? transaction.sourceAccount;
    const send =
      pathPaymentOperation.type === 'pathPaymentStrictSend'
        ? {
            asset: pathPaymentOperation.sendAsset,
            amount: pathPaymentOperation.sendAmount,
          }
        : {
            asset: pathPaymentOperation.sendAsset,
            amount: pathPaymentOperation.sendMax,
          };
    const receive =
      pathPaymentOperation.type === 'pathPaymentStrictSend'
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
      transactionType: TransactionType.Swap,
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
