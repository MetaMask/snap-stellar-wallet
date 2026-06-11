import type { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { StellarKeyringAccount } from '../account';
import { AccountNotActivatedException } from '../network';
import type { OnChainAccountService } from '../on-chain-account';
import type { TransactionService } from '../transaction';
import type { ActivatedAccountPair, SynchronizeOptions } from './api';

export class SynchronizeService {
  readonly #logger: ILogger;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    onChainAccountService,
    transactionService,
  }: {
    logger: ILogger;
    onChainAccountService: OnChainAccountService;
    transactionService: TransactionService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔄 SynchronizeService]');
    this.#onChainAccountService = onChainAccountService;
    this.#transactionService = transactionService;
  }

  async synchronize(
    accounts: StellarKeyringAccount[],
    options?: SynchronizeOptions,
  ): Promise<void> {
    const {
      syncAccounts = true,
      syncTransactions = true,
      scope = AppConfig.selectedNetwork,
    } = options ?? {};

    if (accounts.length === 0) {
      this.#logger.debug('No accounts to synchronize');
      return;
    }

    this.#logger.debug('number of accounts to synchronize', {
      noOfAccounts: accounts.length,
    });

    const activatedAccountPairs = await this.#loadActivatedPairs(
      accounts,
      scope,
    );

    this.#logger.debug('number of activated account pairs', {
      noOfAccounts: activatedAccountPairs.length,
    });

    const tasks: Promise<void>[] = [];
    if (syncAccounts) {
      tasks.push(
        this.#onChainAccountService.synchronize(activatedAccountPairs, scope),
      );
    }
    if (syncTransactions) {
      tasks.push(
        this.#transactionService.synchronize(activatedAccountPairs, scope),
      );
    }

    // Use Promise.allSettled to ensure all tasks are completed, even if some fail.
    await Promise.allSettled(tasks);
  }

  /**
   * Loads each account from Horizon; skips unfunded accounts and logs other failures.
   *
   * @param accounts - Keyring accounts to load.
   * @param scope - CAIP-2 network to query.
   * @returns Pairs keyed for SEP-41 sync and persistence.
   */
  async #loadActivatedPairs(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<ActivatedAccountPair[]> {
    const pairs: ActivatedAccountPair[] = [];

    const results = await Promise.allSettled(
      accounts.map(async (account) => ({
        keyringAccount: account,
        onChainAccount: await this.#onChainAccountService.resolveOnChainAccount(
          account.address,
          scope,
        ),
      })),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        pairs.push(result.value);
        return;
      }
      if (result.reason instanceof AccountNotActivatedException) {
        return;
      }
      this.#logger.logErrorWithDetails('Failed to load account for sync', {
        accountId: accounts[index]?.id,
        error: result.reason,
      });
    });

    return pairs;
  }
}
