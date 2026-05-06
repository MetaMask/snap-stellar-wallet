import type {
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse,
} from './api';
import {
  SignAndSendTransactionJsonRpcRequestStruct,
  SignAndSendTransactionJsonRpcResponseStruct,
} from './api';
import type { KnownCaip2ChainId } from '../../api';
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { WalletService } from '../../services/wallet';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';
import { TrackTransactionHandler } from '../cronjob/trackTransaction';

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

  async #savePendingTransaction(_params: {
    transactionId: string;
    scope: KnownCaip2ChainId;
    account: StellarKeyringAccount;
  }): Promise<void> {
    try {
      // TODO: save a SWAP transaction
    } catch (error: unknown) {
      this.logger.logErrorWithDetails(
        'Failed to save pending transaction',
        error,
      );
      // we should not throw error here, as we want to continue the flow even if the pending transaction is not saved
    }
  }
}
