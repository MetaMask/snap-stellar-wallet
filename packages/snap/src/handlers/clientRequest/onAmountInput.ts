import { BigNumber } from 'bignumber.js';

import type {
  OnAmountInputJsonRpcRequest,
  OnAmountInputJsonRpcResponse,
} from './api';
import {
  MultiChainSendErrorCodes,
  OnAmountInputJsonRpcRequestStruct,
  OnAmountInputJsonRpcResponseStruct,
} from './api';
import { BaseClientRequestHandler } from './base';
import type { AssetMetadataService } from '../../services/asset-metadata';
import { AccountNotActivatedException } from '../../services/network/exceptions';
import type { TransactionService } from '../../services/transaction';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
} from '../../services/transaction/exceptions';
import { hasDecimals, toSmallestUnit } from '../../utils';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type {
  AccountResolver,
  ResolvedActivatedAccount,
} from '../accountResolver';
import { RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE } from '../accountResolver';

export class OnAmountInputHandler extends BaseClientRequestHandler<
  OnAmountInputJsonRpcRequest,
  OnAmountInputJsonRpcResponse
> {
  readonly #logger: ILogger;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    accountResolver,
    assetMetadataService,
    transactionService,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    assetMetadataService: AssetMetadataService;
    transactionService: TransactionService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[💰 OnAmountInputHandler]',
    );
    super({
      accountResolver,
      logger: prefixedLogger,
      requestStruct: OnAmountInputJsonRpcRequestStruct,
      responseStruct: OnAmountInputJsonRpcResponseStruct,
      resolveAccountOptions: RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
    });
    this.#assetMetadataService = assetMetadataService;
    this.#transactionService = transactionService;
    this.#logger = prefixedLogger;
  }

  /**
   * Preflight-validates a send amount for an asset transfer by building a
   * validated send transaction (balance and fee checks only; nothing is signed
   * or submitted). Uses cached network reads for SEP-41 fee simulation so
   * repeated amount checks stay responsive.
   *
   * @param resolved - Keyring account, persisted on-chain snapshot, and wallet.
   * @param request - JSON-RPC request with `assetId`, `value` (positive amount string), and optional `to` (`scope` is derived from `assetId`).
   * @returns Validation result with `valid` and optional error codes.
   */
  protected async execute(
    resolved: ResolvedActivatedAccount,
    request: OnAmountInputJsonRpcRequest,
  ): Promise<OnAmountInputJsonRpcResponse> {
    try {
      const { onChainAccount } = resolved;
      const { assetId, value, to, scope } = request.params;
      const { units } = await this.#assetMetadataService.resolve(assetId);
      const { decimals } = units[0];

      const amountInSmallestUnit = toSmallestUnit(
        new BigNumber(value),
        decimals,
      );

      if (hasDecimals(amountInSmallestUnit)) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.Invalid }],
        };
      }

      await this.#transactionService.createValidatedSendTransaction({
        onChainAccount,
        scope,
        assetId,
        amount: amountInSmallestUnit,
        // If no destination is provided, validate a self-transfer to the sender.
        destination: to ?? onChainAccount.accountId,
        // Use cached network reads so repeated amount checks stay fast.
        useCache: true,
      });

      return {
        valid: true,
        errors: [],
      };
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails(
        'Failed to validate amount input',
        error,
      );
      if (error instanceof InsufficientBalanceException) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.InsufficientBalance }],
        };
      }
      if (error instanceof InsufficientBalanceToCoverFeeException) {
        return {
          valid: false,
          errors: [
            { code: MultiChainSendErrorCodes.InsufficientBalanceToCoverFee },
          ],
        };
      }
      if (
        error instanceof TransactionValidationException ||
        error instanceof AccountNotActivatedException
      ) {
        return {
          valid: false,
          errors: [{ code: MultiChainSendErrorCodes.Invalid }],
        };
      }
      throw error;
    }
  }

  /**
   * Override the base handler to return invalid when the account is not activated.
   * Instead of showing the account not activated alert, it returns an invalid response.
   *
   * @param _error - The error to handle.
   * @returns The invalid response when the account is not activated.
   */
  protected override async handleAccountNotActivatedError(
    _error: AccountNotActivatedException,
  ): Promise<OnAmountInputJsonRpcResponse> {
    return {
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    };
  }
}
