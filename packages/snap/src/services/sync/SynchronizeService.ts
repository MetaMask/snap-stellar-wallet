import type { KnownCaip2ChainId } from '../../api';
import { AppConfig } from '../../config';
import { trackError } from '../../utils';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { StellarKeyringAccount } from '../account';
import type {
  AssetMetadataService,
  StellarAssetMetadata,
} from '../asset-metadata';
import { AccountNotActivatedException } from '../network';
import type { OnChainAccountService } from '../on-chain-account';
import type { TransactionService } from '../transaction';
import type { ActivatedAccountPair, SynchronizeOptions } from './api';

/**
 * Orchestrates Stellar wallet synchronization: on-chain account snapshots, transaction
 * history, and asset metadata. Loads SEP-41 assets once per account sync run and passes
 * them to downstream services.
 */
export class SynchronizeService {
  readonly #logger: ILogger;

  readonly #onChainAccountService: OnChainAccountService;

  readonly #transactionService: TransactionService;

  readonly #assetMetadataService: AssetMetadataService;

  constructor({
    logger,
    onChainAccountService,
    assetMetadataService,
    transactionService,
  }: {
    logger: ILogger;
    onChainAccountService: OnChainAccountService;
    assetMetadataService: AssetMetadataService;
    transactionService: TransactionService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔄 SynchronizeService]');
    this.#onChainAccountService = onChainAccountService;
    this.#transactionService = transactionService;
    this.#assetMetadataService = assetMetadataService;
  }

  /**
   * Synchronizes activated keyring accounts for the given scope.
   *
   * Loads on-chain account pairs and SEP-41 asset metadata in parallel, then runs enabled
   * sync tasks (accounts and/or transactions) concurrently. Unfunded accounts are skipped;
   * per-task failures are logged and do not fail the overall run.
   *
   * @param accounts - Keyring accounts to synchronize.
   * @param options - Optional flags for scope and which sync steps to run. Defaults to synchronizing accounts and transactions on the selected network.
   */
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

    if (!syncAccounts && !syncTransactions) {
      this.#logger.debug('No sync steps to run');
      return;
    }

    // Both async loads are fail-safe, so we can use Promise.all.
    const [activatedAccountPairs, sep41Assets] = await Promise.all([
      this.#loadActivatedPairsSafe(accounts, scope),
      this.#loadSep41AssetsSafe(scope),
    ]);

    const tasks: { name: string; task: Promise<void> }[] = [];

    if (syncAccounts) {
      tasks.push({
        name: 'synchronize accounts',
        task: this.#onChainAccountService.synchronize(
          activatedAccountPairs,
          scope,
          sep41Assets,
        ),
      });
    }

    if (syncTransactions) {
      tasks.push({
        name: 'synchronize transactions',
        task: this.#transactionService.synchronize(
          activatedAccountPairs,
          scope,
          sep41Assets,
        ),
      });
    }

    const results = await Promise.allSettled(
      tasks.map(async ({ task }) => task),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        await trackError(result.reason);

        const taskName = tasks[index]?.name ?? 'synchronize';
        this.#logger.warn(`Failed to ${taskName}`, {
          error: result.reason,
        });
      }
    }
  }

  /**
   * Fetches and persists the full asset catalog from the token API for the given scope.
   *
   * Intended for the declarative `synchronizeAssets` cron job. Failures are logged and
   * do not propagate to the caller.
   *
   * @param scope - CAIP-2 network to synchronize asset metadata for.
   */
  async synchronizeAssets(scope: KnownCaip2ChainId): Promise<void> {
    try {
      await this.#assetMetadataService.synchronize(scope);
    } catch (error: unknown) {
      await trackError(error);

      this.#logger.warn('Failed to synchronize assets', {
        error,
      });
    }
  }

  /**
   * Loads the full asset catalog from the token API for the given scope.
   *
   * @param scope - CAIP-2 network to load asset metadata for.
   * @returns The full asset catalog.
   */
  async #loadSep41AssetsSafe(
    scope: KnownCaip2ChainId,
  ): Promise<StellarAssetMetadata[]> {
    try {
      return await this.#assetMetadataService.fetchSep41AssetsOrSyncOnce(scope);
    } catch (error: unknown) {
      await trackError(error);

      this.#logger.warn('Failed to load SEP-41 assets', {
        error,
      });

      return [];
    }
  }

  /**
   * Loads each account from Horizon; skips unfunded accounts and logs other failures.
   *
   * @param accounts - Keyring accounts to load.
   * @param scope - CAIP-2 network to query.
   * @returns Pairs keyed for SEP-41 sync and persistence.
   */
  async #loadActivatedPairsSafe(
    accounts: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<ActivatedAccountPair[]> {
    this.#logger.debug('number of accounts to synchronize', {
      noOfAccounts: accounts.length,
    });

    const results = await Promise.all(
      accounts.map(async (account): Promise<ActivatedAccountPair | null> => {
        try {
          return {
            keyringAccount: account,
            onChainAccount:
              await this.#onChainAccountService.resolveOnChainAccount(
                account.address,
                scope,
              ),
          };
        } catch (error: unknown) {
          // Only capture the error if it is unexpected.
          // AccountNotActivatedException is expected when the account is not activated yet.
          if (!(error instanceof AccountNotActivatedException)) {
            await trackError(error);

            this.#logger.warn('Failed to load account for sync', { error });
          }
          return null;
        }
      }),
    );

    const pairs: ActivatedAccountPair[] = results.filter(
      (result): result is ActivatedAccountPair => result !== null,
    );

    this.#logger.debug('number of activated account pairs', {
      noOfAccounts: pairs.length,
    });

    return pairs;
  }
}
