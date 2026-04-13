import type { Horizon } from '@stellar/stellar-sdk';
import { Account as StellarAccount } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { OnChainAccountSnapshot } from './api';
import {
  OnChainAccountBalanceNotAvailableException,
  OnChainAccountMetadataNotAvailableException,
} from './exceptions';
import { calculateSpendableBalance } from './utils';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip2ChainId,
} from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  entries,
  getAssetReference,
  getSlip44AssetId,
  isClassicAssetId,
  isSep41Id,
  isSlip44Id,
  parseClassicAssetCodeIssuer,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../utils';
import type {
  AccountBalance,
  BaseAssetBalance,
  TrustLineAssetBalance,
} from '../account-balance/api';

/** Per-asset view: native, classic trustline (limit + issuer in `address`), or SEP-41. */
export type SpendableBalance = {
  balance: BigNumber;
  symbol: string;
  limit?: BigNumber;
  address?: string;
  authorized?: boolean;
  sponsored?: boolean;
};

/** Ledger fields used for native reserve / spendable math (Horizon or persisted snapshot). */
export type OnChainAccountLedgerMeta = {
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
};

/**
 * Where {@link OnChainAccount} builds native + trustline maps from.
 *
 * - **horizon** — full Horizon account response (human-readable balances).
 * - **accountBalance** — persisted {@link AccountBalance} (amounts in stroops as strings). For the slip44 native key, `amount` is **total** (raw) stroops; spendable native is derived at bind time via {@link calculateSpendableBalance} and snapshot meta.
 */
export type OnChainData =
  | { source: 'horizon'; response: Horizon.AccountResponse }
  | {
      source: 'accountBalance';
      balances: AccountBalance;
      meta: OnChainAccountLedgerMeta;
    };

export class OnChainAccount {
  readonly #account: StellarAccount;

  readonly #scope: KnownCaip2ChainId;

  #subentryCount: number | undefined;

  #numSponsoring: number | undefined;

  #numSponsored: number | undefined;

  #rawNativeBalance: BigNumber | undefined;

  readonly #balances: Map<KnownCaip19AssetIdOrSlip44Id, SpendableBalance> =
    new Map();

  /**
   * @param account - Stellar SDK account (id + sequence). Use {@link getRaw}.
   * @param scope - CAIP-2 network.
   * @param onChainData - When set, hydrates from Horizon or persisted {@link AccountBalance}; when omitted, uses `account.balances` when present (e.g. `loadAccount` result).
   */
  constructor(
    account: StellarAccount,
    scope: KnownCaip2ChainId,
    onChainData?: OnChainData,
  ) {
    this.#account = account;
    this.#scope = scope;

    if (onChainData?.source === 'horizon') {
      this.#bindFromHorizonResponse(onChainData.response);
    } else if (onChainData?.source === 'accountBalance') {
      this.#bindFromAccountBalance(onChainData.balances, onChainData.meta);
    } else if (onChainData === undefined && this.#isHorizonResponse(account)) {
      this.#bindFromHorizonResponse(account);
    }
  }

  get accountId(): string {
    return this.#account.accountId();
  }

  get sequenceNumber(): string {
    return this.#account.sequenceNumber();
  }

  get scope(): KnownCaip2ChainId {
    return this.#scope;
  }

  get subentryCount(): number {
    if (this.#subentryCount !== undefined) {
      return this.#subentryCount;
    }
    throw new OnChainAccountMetadataNotAvailableException(this.accountId);
  }

  get numSponsoring(): number {
    if (this.#numSponsoring !== undefined) {
      return this.#numSponsoring;
    }
    throw new OnChainAccountMetadataNotAvailableException(this.accountId);
  }

  get numSponsored(): number {
    if (this.#numSponsored !== undefined) {
      return this.#numSponsored;
    }
    throw new OnChainAccountMetadataNotAvailableException(this.accountId);
  }

  /**
   * Checks if the account has a balance for a given asset id.
   *
   * @param assetId - The asset id to check.
   * @returns `true` if the account has a balance for the given asset id, `false` otherwise.
   */
  hasAsset(assetId: KnownCaip19AssetIdOrSlip44Id): boolean {
    return this.#balances.has(assetId);
  }

  /**
   * Gets the balance for a given asset id.
   *
   * @param assetId - The asset id to get the balance for.
   * @returns The balance for the given asset id.
   */
  getAsset(assetId: KnownCaip19AssetIdOrSlip44Id): SpendableBalance {
    const entry = this.#balances.get(assetId);
    if (entry !== undefined) {
      return {
        balance: entry.balance,
        symbol: entry.symbol,
        address: entry.address,
        ...(entry.limit === undefined ? {} : { limit: entry.limit }),
        ...(entry.sponsored === undefined
          ? {}
          : { sponsored: entry.sponsored }),
        ...(entry.authorized === undefined
          ? {}
          : { authorized: entry.authorized }),
      };
    }
    throw new OnChainAccountBalanceNotAvailableException(
      assetId,
      this.accountId,
    );
  }

  /**
   * Classic Stellar trustline asset ids (CAIP-19) that have a balance row with a limit.
   *
   * @returns Asset ids for which {@link getAsset} includes `limit` (classic trustlines only).
   */
  get classicTrustlineAssetIds(): KnownCaip19ClassicAssetId[] {
    const ids: KnownCaip19ClassicAssetId[] = [];
    for (const [assetId, row] of this.#balances) {
      if (isClassicAssetId(assetId) && row.limit !== undefined) {
        ids.push(assetId);
      }
    }
    return ids;
  }

  get nativeSpendableBalance(): BigNumber {
    const nativeId = getSlip44AssetId(this.#scope);
    const entry = this.#balances.get(nativeId);
    if (entry === undefined) {
      throw new OnChainAccountBalanceNotAvailableException(
        nativeId,
        this.accountId,
      );
    }
    return entry.balance;
  }

  get nativeRawBalance(): BigNumber {
    const nativeId = getSlip44AssetId(this.#scope);
    if (this.#rawNativeBalance === undefined) {
      throw new OnChainAccountBalanceNotAvailableException(
        nativeId,
        this.accountId,
      );
    }
    return this.#rawNativeBalance;
  }

  /**
   * Gets the raw Stellar account.
   *
   * @returns The raw Stellar account.
   */
  getRaw(): StellarAccount {
    return this.#account;
  }

  /**
   * Builds from a Horizon account record (balances and ledger meta from the response).
   *
   * @param response - Horizon `loadAccount` payload.
   * @param scope - CAIP-2 network.
   * @returns Hydrated {@link OnChainAccount} backed by a minimal SDK `Account` plus derived maps.
   */
  static fromHorizon(
    response: Horizon.AccountResponse,
    scope: KnownCaip2ChainId,
  ): OnChainAccount {
    const stellarAccount = new StellarAccount(
      response.accountId(),
      response.sequenceNumber(),
    );
    return new OnChainAccount(stellarAccount, scope, {
      source: 'horizon',
      response,
    });
  }

  /**
   * Hydrates from persisted {@link OnChainAccountSnapshot} plus {@link AccountBalance} (e.g. snap state after sync).
   *
   * @param params - Snapshot row, per-asset balances, and network.
   * @param params.snapshot - Sequence and subentry/sponsoring fields from metadata sync.
   * @param params.balances - Persisted balances; native slip44 `amount` is **raw** (total) stroops.
   * @param params.scope - CAIP-2 network.
   * @returns Hydrated {@link OnChainAccount} for the same id/sequence as the snapshot.
   */
  static fromSnapshot(params: {
    snapshot: OnChainAccountSnapshot;
    balances: AccountBalance;
    scope: KnownCaip2ChainId;
  }): OnChainAccount {
    const { snapshot, balances, scope } = params;
    const stellarAccount = new StellarAccount(
      snapshot.accountId,
      snapshot.sequenceNumber,
    );
    return new OnChainAccount(stellarAccount, scope, {
      source: 'accountBalance',
      balances,
      meta: {
        subentryCount: snapshot.subentryCount,
        numSponsoring: snapshot.numSponsoring,
        numSponsored: snapshot.numSponsored,
      },
    });
  }

  #bindFromHorizonResponse(response: Horizon.AccountResponse): void {
    const subentryCount = response.subentry_count ?? 0;
    const numSponsoring = response.num_sponsoring ?? 0;
    const numSponsored = response.num_sponsored ?? 0;
    this.#subentryCount = subentryCount;
    this.#numSponsoring = numSponsoring;
    this.#numSponsored = numSponsored;

    const nativeAssetId = getSlip44AssetId(this.#scope);

    const horizonBalances = response.balances;

    for (const balance of horizonBalances) {
      // Horizon API return balance as human-readable (e.g. 1.23456789), we need to convert it to stroops
      const balanceStroops = toSmallestUnit(new BigNumber(balance.balance));
      // Native balance is always return for Horizon response
      if (balance.asset_type === 'native') {
        this.#balances.set(nativeAssetId, {
          balance: calculateSpendableBalance({
            nativeBalance: balanceStroops,
            subentryCount,
            numSponsoring,
            numSponsored,
          }),
          symbol: NATIVE_ASSET_SYMBOL,
        });
        this.#rawNativeBalance = balanceStroops;
      } else if (
        balance.asset_type === 'credit_alphanum12' ||
        balance.asset_type === 'credit_alphanum4'
      ) {
        const authorized = balance.is_authorized ?? true;
        const assetId = toCaip19ClassicAssetId(
          this.#scope,
          balance.asset_code,
          balance.asset_issuer,
        );
        // Horizon API return limit as human-readable (e.g. 1.23456789), we need to convert it to stroops
        const limit = toSmallestUnit(new BigNumber(balance.limit ?? 0));
        const sponsorId =
          'sponsor' in balance &&
          typeof (balance as { sponsor?: string }).sponsor === 'string'
            ? (balance as { sponsor?: string }).sponsor
            : undefined;
        const sponsored = sponsorId !== undefined && sponsorId.length > 0;
        this.#balances.set(assetId, {
          balance: balanceStroops,
          symbol: balance.asset_code,
          address: balance.asset_issuer,
          limit,
          authorized,
          ...(sponsored ? { sponsored: true } : {}),
        });
      }
    }
  }

  #bindFromAccountBalance(
    balances: AccountBalance,
    meta: OnChainAccountLedgerMeta,
  ): void {
    this.#subentryCount = meta.subentryCount;
    this.#numSponsoring = meta.numSponsoring;
    this.#numSponsored = meta.numSponsored;
    this.#rawNativeBalance = new BigNumber(0);

    const nativeAssetId = getSlip44AssetId(this.#scope);

    entries(balances).forEach(([assetId, entry]) => {
      if (entry === undefined) {
        return;
      }

      if (isSlip44Id(assetId)) {
        // raw native balance in stroops
        const rawNative = new BigNumber(entry.amount);
        this.#rawNativeBalance = rawNative;
        this.#balances.set(nativeAssetId, {
          balance: calculateSpendableBalance({
            nativeBalance: rawNative,
            subentryCount: meta.subentryCount,
            numSponsoring: meta.numSponsoring,
            numSponsored: meta.numSponsored,
          }),
          symbol: entry.unit,
        });
      } else if (
        isClassicAssetId(assetId) &&
        this.#isTrustLineAssetBalance(entry)
      ) {
        const trust = entry;
        const { assetIssuer } = parseClassicAssetCodeIssuer(
          getAssetReference(assetId),
        );
        const balanceStroops = new BigNumber(trust.amount);
        const limitStroops = new BigNumber(trust.limit);
        this.#balances.set(assetId, {
          balance: balanceStroops,
          symbol: trust.unit,
          limit: limitStroops,
          address: assetIssuer,
          ...(typeof trust.authorized === 'boolean'
            ? { authorized: trust.authorized }
            : {}),
          ...(trust.sponsored === true ? { sponsored: true } : {}),
        });
      } else if (isSep41Id(assetId)) {
        this.#balances.set(assetId, {
          balance: new BigNumber(entry.amount),
          symbol: entry.unit,
        });
      }
    });
  }

  #isHorizonResponse(
    account: StellarAccount,
  ): account is Horizon.AccountResponse {
    return account !== undefined && 'balances' in account;
  }

  #isTrustLineAssetBalance(
    value: BaseAssetBalance | TrustLineAssetBalance | undefined,
  ): value is TrustLineAssetBalance {
    return (
      value !== undefined &&
      typeof (value as TrustLineAssetBalance).limit === 'string'
    );
  }
}
