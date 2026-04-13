import type { AccountBalanceRepository } from './AccountBalanceRepository';
import type { AccountBalance } from './api';
import { type KnownCaip2ChainId } from '../../api';
import {
  createPrefixedLogger,
  getSlip44AssetId,
  isSep41Id,
  batchesAllSettled,
  type ILogger,
} from '../../utils';
import type { AssetMetadata, AssetMetadataService } from '../asset-metadata';
import type { NetworkService } from '../network';
import type { OnChainAccount } from '../on-chain-account';
import type { SynchronizeAccountPairs } from '../synchronize/api';

export class AccountBalanceService {
  readonly #assetMetadataService: AssetMetadataService;

  readonly #accountBalanceRepository: AccountBalanceRepository;

  readonly #networkService: NetworkService;

  readonly #logger: ILogger;

  static readonly rpcFetchBatchSize = 10;

  constructor({
    assetMetadataService,
    accountBalanceRepository,
    networkService,
    logger,
  }: {
    assetMetadataService: AssetMetadataService;
    accountBalanceRepository: AccountBalanceRepository;
    networkService: NetworkService;
    logger: ILogger;
  }) {
    this.#assetMetadataService = assetMetadataService;
    this.#networkService = networkService;
    this.#accountBalanceRepository = accountBalanceRepository;
    this.#logger = createPrefixedLogger(logger, '[💰 AccountBalanceService]');
  }

  /**
   * Gets the balances for a given account id.
   *
   * @param accountId - The id of the account to get the balances for.
   * @returns A promise that resolves to the persisted {@link AccountBalance} map, or `null` if none.
   */
  async getBalancesByAccountId(
    accountId: string,
  ): Promise<AccountBalance | null> {
    const balances =
      await this.#accountBalanceRepository.findByAccountId(accountId);
    if (!balances) {
      return null;
    }
    return balances.balances;
  }

  /**
   * Persists balances using accounts already loaded via {@link NetworkService.loadOnChainAccount}
   * (native, trustlines, and SEP-41 token queries only — no second account load).
   *
   * @param pairs - Keyring rows paired with their Horizon `OnChainAccount`.
   * @param scope - CAIP-2 network the `loaded` accounts were fetched from.
   */
  async synchronize(
    pairs: SynchronizeAccountPairs[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    try {
      if (pairs.length === 0) {
        return;
      }

      // assume Horizon API already loaded trustlines assets for the accounts,
      // so we only need to fetch SEP-41 token balances
      const assets =
        await this.#assetMetadataService.getAllSep41AssetsMetadata(scope);

      const results = await Promise.allSettled(
        pairs.map(async (pair) => {
          // 1. Horizon `loadOnChainAccount`: native + classic trustlines (no extra account fetch).
          const fromOnChainAccount =
            this.#synchronizeBalancesFromOnChainAccount(
              scope,
              pair.onChainAccount,
            );
          // 2. Soroban SEP-41 balances for configured assets.
          const fromNetwork = await this.#synchronizeSep41BalancesFromNetwork(
            scope,
            assets,
            pair.onChainAccount,
          );
          return { ...fromOnChainAccount, ...fromNetwork };
        }),
      );

      const accountBalances: Record<string, AccountBalance> = {};

      results.forEach((result, index) => {
        const pair = pairs[index];
        if (pair === undefined) {
          return;
        }
        if (result.status === 'fulfilled') {
          accountBalances[pair.account.id] = result.value;
        } else {
          this.#logger.logErrorWithDetails(
            'Failed to synchronize balances for account',
            {
              accountId: pair.account.id,
              error: result.reason,
            },
          );
        }
      });

      // 3. Persist merged balances per keyring account.
      await this.#accountBalanceRepository.saveMany(accountBalances);
    } catch (error) {
      // log error but continue the synchronization process
      this.#logger.logErrorWithDetails('Failed to synchronize balances', {
        error,
      });
    }
  }

  /**
   * Native XLM + classic trustline balances from a single Horizon `loadOnChainAccount` result (no network I/O).
   *
   * @param scope - CAIP-2 chain id for native and classic asset id mapping.
   * @param onChainAccount - Account state from Horizon (or equivalent) with balances and trustlines.
   * @returns Partial {@link AccountBalance} for native XLM and classic assets only. Native `amount` is **raw** (total) stroops.
   */
  #synchronizeBalancesFromOnChainAccount(
    scope: KnownCaip2ChainId,
    onChainAccount: OnChainAccount,
  ): AccountBalance {
    // Collect native balance.
    const nativeAssetId = getSlip44AssetId(scope);
    const balances: AccountBalance = {
      [nativeAssetId]: {
        unit: onChainAccount.getAsset(nativeAssetId).symbol,
        // Collect raw native balance.
        amount: onChainAccount.nativeRawBalance.toString(),
      },
    };

    // Collect classic trustline balances.
    for (const assetId of onChainAccount.classicTrustlineAssetIds) {
      const row = onChainAccount.getAsset(assetId);
      balances[assetId] = {
        unit: row.symbol,
        // we store the limit and balance in stroops
        amount: row.balance.toString(),
        limit: row.limit?.toString() ?? '0',
        ...(typeof row.authorized === 'boolean'
          ? { authorized: row.authorized }
          : {}),
        ...(row.sponsored ? { sponsored: true } : {}),
      };
    }

    return balances;
  }

  /**
   * Soroban SEP-41 token balances via RPC (in parallel per configured asset).
   *
   * @param scope - CAIP-2 chain id for RPC endpoints.
   * @param sep41AssetsMetadata - SEP-41 assets to query balances for.
   * @param onChainAccount - Account whose id and sequence are passed to balance RPC calls.
   * @returns Partial {@link AccountBalance} for SEP-41 tokens only.
   */
  async #synchronizeSep41BalancesFromNetwork(
    scope: KnownCaip2ChainId,
    sep41AssetsMetadata: AssetMetadata[],
    onChainAccount: OnChainAccount,
  ): Promise<AccountBalance> {
    const balances: AccountBalance = {};

    await batchesAllSettled(
      sep41AssetsMetadata,
      AccountBalanceService.rpcFetchBatchSize,
      async (metadata) => {
        const { assetId } = metadata;
        if (!isSep41Id(assetId)) {
          return;
        }
        const balance = await this.#networkService.getSep41TokenBalance({
          accountAddress: onChainAccount.accountId,
          assetId,
          scope,
          sequenceNumber: onChainAccount.sequenceNumber,
        });
        // skip non-trustline assets if the balance is 0
        if (balance.isEqualTo(0)) {
          return;
        }
        balances[assetId] = {
          unit: metadata.symbol,
          amount: balance.toString(),
        };
      },
    );

    return balances;
  }
}
