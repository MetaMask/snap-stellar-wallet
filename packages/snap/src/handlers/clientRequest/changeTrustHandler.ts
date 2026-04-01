/* eslint-disable @typescript-eslint/no-unused-vars */
import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/utils';
import { ensureError } from '@metamask/utils';

import { SignChangeTrustlineJsonRpcRequestStruct } from './api';
import type { KnownCaip2ChainId, StellarAddress } from '../../api';
import type { AccountService } from '../../services/account';
import type { WalletService } from '../../services/wallet';
import { AccountNotActivatedException } from '../../services/wallet';
import { validateRequest } from '../../utils';
import { createPrefixedLogger, type ILogger } from '../../utils/logger';

export class ChangeTrustHandler {
  readonly #logger: ILogger;

  readonly #accountService: AccountService;

  readonly #walletService: WalletService;

  constructor({
    logger,
    accountService,
    walletService,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💼 ChangeTrustHandler]');
    this.#accountService = accountService;
    this.#walletService = walletService;
  }

  /**
   * Handles a change trustline transaction request.
   *
   * @param request - The JSON-RPC request containing the change trustline transaction.
   * @returns A promise that resolves to the JSON-RPC response.
   */
  async handle(request: JsonRpcRequest): Promise<Json> {
    validateRequest(request, SignChangeTrustlineJsonRpcRequestStruct);

    const { scope, accountId, asset } = request.params;

    try {
      const {
        wallet,
        account: { address },
      } = await this.#accountService.resolveAccount({
        scope,
        accountIdOrAddress: accountId,
        resolveOptions: {
          activated: true,
        },
      });

      const baseFee = await this.#walletService.network.getBaseFee(scope);

      // build a transaction for change trustline without assigning the actual sequence number yet
      const transaction = this.#walletService.builder.changeTrust({
        account: wallet,
        asset,
        scope,
        baseFee: baseFee.toString(),
      });

      const confirmed = await this.#confirmSignChangeTrustline({
        scope,
        address,
        asset,
        fee: transaction.getTotalFee().toString(),
      });

      if (!confirmed) {
        throw ensureError(new UserRejectedRequestError());
      }

      await this.#walletService.signTransaction({
        account: wallet,
        scope,
        transaction,
        baseFee,
      });

      return await this.#walletService.network.send({
        transaction,
        scope,
        pollTransaction: true,
      });
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        await this.#showAccountNotActivatedAlert();
        return null;
      }

      this.#logger.error('Failed to handle change trustline transaction', {
        error,
      });

      throw ensureError(
        new Error('Failed to handle change trustline transaction'),
      );
    }
  }

  async #showAccountNotActivatedAlert(): Promise<void> {
    throw new Error('Account not implemented');
  }

  async #confirmSignChangeTrustline({
    scope,
    address,
    asset,
    fee,
  }: {
    scope: KnownCaip2ChainId;
    address: StellarAddress;
    asset: string;
    fee: string;
  }): Promise<boolean> {
    return true;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
