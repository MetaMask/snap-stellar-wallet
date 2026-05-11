import { parseCaipAssetType, type Json } from '@metamask/utils';
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
import type { ResolvedActivatedAccount } from '../base';
import { WithClientRequestActiveAccountResolve } from './base';
import type { KnownCaip2ChainId } from '../../api';
import type { AccountService } from '../../services/account';
import type { AssetMetadataService } from '../../services/asset-metadata';
import { AccountNotActivatedException } from '../../services/network/exceptions';
import type { OnChainAccountService } from '../../services/on-chain-account';
import type { TransactionService } from '../../services/transaction';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
} from '../../services/transaction/exceptions';
import type { WalletService } from '../../services/wallet';
import { toSmallestUnit } from '../../utils';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class OnAmountInputHandler extends WithClientRequestActiveAccountResolve<
  OnAmountInputJsonRpcRequest,
  OnAmountInputJsonRpcResponse
> {
  readonly #logger: ILogger;

  readonly #assetMetadataService: AssetMetadataService;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    accountService,
    onChainAccountService,
    walletService,
    assetMetadataService,
    transactionService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    onChainAccountService: OnChainAccountService;
    walletService: WalletService;
    assetMetadataService: AssetMetadataService;
    transactionService: TransactionService;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[💰 OnAmountInputHandler]',
    );
    super({
      accountService,
      onChainAccountService,
      walletService,
      logger: prefixedLogger,
      requestStruct: OnAmountInputJsonRpcRequestStruct,
      responseStruct: OnAmountInputJsonRpcResponseStruct,
    });
    this.#assetMetadataService = assetMetadataService;
    this.#transactionService = transactionService;
    this.#logger = prefixedLogger;
  }

  /**
   * Validates that the sender can afford a transfer of `params.value`.
   *
   * @param resolved - Activated keyring account and wallet.
   * @param request - JSON-RPC request with `assetId` and `value` (positive amount string).
   * @returns Validation result with `valid` and optional error codes.
   */
  async _handle(
    resolved: ResolvedActivatedAccount,
    request: OnAmountInputJsonRpcRequest,
  ): Promise<OnAmountInputJsonRpcResponse> {
    try {
      const { onChainAccount } = resolved;
      const { assetId, value, to } = request.params;

      const scope = parseCaipAssetType(assetId).chainId as KnownCaip2ChainId;
      const { units } = await this.#assetMetadataService.resolve(assetId);
      const { decimals } = units[0];

      // Reserved for balance / fee checks once send validation is wired here.

      const amountInSmallestUnit = toSmallestUnit(
        new BigNumber(value),
        decimals,
      );

      await this.#transactionService.createValidatedSendTransaction({
        onChainAccount,
        scope,
        assetId,
        amount: amountInSmallestUnit,
        // if the destination is not provided,
        // use the from account address as the destination
        destination: to ?? onChainAccount.accountId,
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

  protected async handleAccountNotActivatedError(): Promise<Json> {
    // if the account is not activated,
    // this account should have no balance, instead of throwing an error
    // so we return an insufficient balance error
    return {
      valid: false,
      errors: [
        { code: MultiChainSendErrorCodes.InsufficientBalanceToCoverFee },
      ],
    };
  }
}
