import { FeeType } from '@metamask/keyring-api';
import { BigNumber } from 'bignumber.js';

import type {
  ComputeFeeJsonRpcRequest,
  ComputeFeeJsonRpcResponse,
} from './api';
import {
  ComputeFeeJsonRpcRequestStruct,
  ComputeFeeJsonRpcResponseStruct,
} from './api';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { BaseClientRequestHandler } from './base';
import { KnownCaip19Slip44IdMap } from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
} from '../../services/transaction';
import type { TransactionService } from '../../services/transaction/TransactionService';
import { isSlip44Id } from '../../utils';
import { toDisplayBalance } from '../../utils/currency';
import { createPrefixedLogger } from '../../utils/logger';
import type { ILogger } from '../../utils/logger';

export class ComputeFeeHandler extends BaseClientRequestHandler<
  ComputeFeeJsonRpcRequest,
  ComputeFeeJsonRpcResponse
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
      '[💰 ComputeFeeHandler]',
    );
    super({
      accountResolver,
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
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: ComputeFeeJsonRpcRequest,
  ): Promise<ComputeFeeJsonRpcResponse> {
    const { onChainAccount } = resolved;
    const { transaction: transactionBase64Xdr, scope } = request.params;

    try {
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
            unit: NATIVE_ASSET_SYMBOL,
            type: KnownCaip19Slip44IdMap[scope],
            amount: toDisplayBalance(transaction.totalFee),
            fungible: true as const,
          },
        },
      ];
    } catch (error) {
      if (
        (error instanceof InsufficientBalanceException &&
          isSlip44Id(error.assetId)) ||
        error instanceof InsufficientBalanceToCoverFeeException
      ) {
        return [
          {
            type: FeeType.Base,
            asset: {
              unit: NATIVE_ASSET_SYMBOL,
              type: KnownCaip19Slip44IdMap[scope],
              amount: toDisplayBalance(new BigNumber(error.required)),
              fungible: true as const,
            },
          },
        ];
      }
      throw error;
    }
  }
}
