import type {
  SignAndSendTransactionJsonRpcRequest,
  SignAndSendTransactionJsonRpcResponse,
} from './api';
import {
  SignAndSendTransactionJsonRpcRequestStruct,
  SignAndSendTransactionJsonRpcResponseStruct,
} from './api';
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import type { AccountService } from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { WalletService } from '../../services/wallet';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

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
   * Signs and submits the Soroban envelope after {@link ComputeFeeHandler} (same `params.transaction` XDR
   * and `params.scope` the client used for the fee quote). The API-built tx is expected to use the user
   * as source; validation matches {@link TransactionService.createValidatedDeserializeTransaction}.
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
    const { wallet, onChainAccount } = resolved;
    const { transaction: transactionBase64Xdr, scope } = request.params;

    const transaction =
      await this.#transactionService.createValidatedDeserializeTransaction({
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

    return {
      transactionId: transactionHash,
    };
  }
}
