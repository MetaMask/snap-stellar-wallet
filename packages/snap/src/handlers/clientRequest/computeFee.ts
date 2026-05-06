import { FeeType } from '@metamask/keyring-api';

import type {
  ComputeFeeJsonRpcRequest,
  ComputeFeeJsonRpcResponse,
} from './api';
import {
  ComputeFeeJsonRpcRequestStruct,
  ComputeFeeJsonRpcResponseStruct,
} from './api';
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import { KnownCaip19Slip44IdMap } from '../../api';
import type { AccountService } from '../../services/account';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction/TransactionService';
import type { WalletService } from '../../services/wallet';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

export class ComputeFeeHandler extends WithClientRequestActiveAccountResolve<
  ComputeFeeJsonRpcRequest,
  ComputeFeeJsonRpcResponse
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
      '[💰 ComputeFeeHandler]',
    );
    super({
      accountService,
      onChainAccountService,
      walletService,
      logger: prefixedLogger,
      requestStruct: ComputeFeeJsonRpcRequestStruct,
      responseStruct: ComputeFeeJsonRpcResponseStruct,
    });
    this.#transactionService = transactionService;
  }

  /**
   * Computes the fee for a swap envelope built by MetaMask CrossChain API and consumed by {@link SignAndSendTransactionHandler}.
   *
   * **Client workflow**
   * 1. After the user selects a quote, obtain the unsigned XDR from MetaMask CrossChain API.
   * 2. Call **computeFee** with that XDR and `scope` so the user can review fees in stroops.
   * 3. After approval in your UI, call **signAndSendTransaction** with the **same** `transaction` XDR and `scope`.
   *
   * Uses {@link TransactionService.createValidatedSwapTransaction} — the same decode, validation, and fee
   * simulation path as sign-and-send (including Soroban simulation when the envelope uses contract calls)
   * — then reads {@link Transaction.totalFee} on the wrapped transaction.
   *
   * @param resolved - The resolved activated account and wallet ({@link ResolvedActivatedAccount}).
   * @param request - The JSON-RPC request containing transaction details.
   * @param request.params.transaction - The Base64 encoded XDR of the transaction.
   * @param request.params.scope - The CAIP-2 chain ID.
   * @returns Fee entries for the client ({@link ComputeFeeJsonRpcResponse}).
   */
  async _handle(
    resolved: ResolvedActivatedAccount,
    request: ComputeFeeJsonRpcRequest,
  ): Promise<ComputeFeeJsonRpcResponse> {
    const { onChainAccount } = resolved;
    const { transaction: transactionBase64Xdr, scope } = request.params;

    const transaction =
      await this.#transactionService.createValidatedSwapTransaction({
        xdr: transactionBase64Xdr,
        scope,
        onChainAccount,
      });

    return [
      {
        type: FeeType.Base,
        asset: {
          unit: 'Stroop',
          type: KnownCaip19Slip44IdMap[scope],
          amount: transaction.totalFee.toString(),
          fungible: true as const,
        },
      },
    ];
  }
}
