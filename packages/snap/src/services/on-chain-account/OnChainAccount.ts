import type { Horizon } from '@stellar/stellar-sdk';
import { Account as StellarAccount } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { SpendableBalance } from './api';
import {
  OnChainAccountBalanceNotAvailableException,
  OnChainAccountException,
  OnChainAccountMetadataNotAvailableException,
} from './exceptions';
import type { OnChainAccountSerializable } from './OnChainAccountSerializable';
import { calculateSpendableBalance, minimumBalanceStroops } from './utils';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip2ChainId,
} from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  entries,
  getSlip44AssetId,
  isClassicAssetId,
  isSep41Id,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../utils';

/**
 * SDK {@link StellarAccount} plus optional {@link OnChainAccountSerializable} hydration (balances, meta).
 * Build via {@link OnChainAccount.fromHorizon}, {@link OnChainAccount.fromSerializable}, or `new OnChainAccount(account, scope)` (RPC: no binding, sequence only; use Horizon for balances).
 * Without `binding`, only id, sequence, `scope`, and {@link OnChainAccount.getRaw} are defined; balances and meta need hydration.
 */
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
   * @param account - Stellar SDK account (id + sequence). When `binding` is set, header fields must match.
   * @param scope - CAIP-2 network; must match `binding.scope`.
   * @param binding - Hydrate from snapshot; omit for RPC-style accounts (see class overview).
   */
  constructor(
    account: StellarAccount,
    scope: KnownCaip2ChainId,
    binding?: OnChainAccountSerializable,
  ) {
    this.#account = account;
    this.#scope = scope;

    if (binding === undefined) {
      return;
    }

    if (binding.scope !== scope) {
      throw new OnChainAccountException(
        'Binding scope must match constructor scope',
      );
    }
    if (
      binding.accountId !== account.accountId() ||
      binding.sequenceNumber !== account.sequenceNumber()
    ) {
      throw new OnChainAccountException(
        'Binding account id/sequence must match the Stellar Account instance',
      );
    }
    this.#bindFromSerializable(binding);
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
        ...entry,
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

  /**
   * Gets all asset ids for the on-chain account.
   *
   * @returns All asset ids for the on-chain account.
   */
  get assetIds(): KnownCaip19AssetIdOrSlip44Id[] {
    return Array.from(this.#balances.keys());
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
   * Copies id, sequence, network, ledger meta, and all bound balances into a plain object.
   *
   * @returns suitable for persistence or messaging.
   */
  toSerializable(): OnChainAccountSerializable {
    const balances = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      SpendableBalance
    >;
    for (const assetId of this.#balances.keys()) {
      balances[assetId] = this.getAsset(assetId);
    }

    return {
      accountId: this.accountId,
      sequenceNumber: this.sequenceNumber,
      scope: this.#scope,
      meta: {
        subentryCount: this.subentryCount,
        numSponsoring: this.numSponsoring,
        numSponsored: this.numSponsored,
      },
      balances,
    };
  }

  /**
   * Builds from a Horizon `loadAccount` response: maps balances and ledger meta into
   * {@link OnChainAccountSerializable} (same shape as {@link OnChainAccount#toSerializable}), then hydrates.
   * When the response has no native balance line, the binding omits native so behavior matches a partial load.
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
    const subentryCount = response.subentry_count ?? 0;
    const numSponsoring = response.num_sponsoring ?? 0;
    const numSponsored = response.num_sponsored ?? 0;
    const meta = { subentryCount, numSponsoring, numSponsored };
    const nativeAssetId = getSlip44AssetId(scope);
    const balances = {} as Record<
      KnownCaip19AssetIdOrSlip44Id,
      SpendableBalance
    >;

    const horizonBalances = response.balances ?? [];

    for (const balance of horizonBalances) {
      const balanceStroops = toSmallestUnit(new BigNumber(balance.balance));
      if (balance.asset_type === 'native') {
        balances[nativeAssetId] = {
          balance: calculateSpendableBalance({
            nativeBalance: balanceStroops,
            subentryCount,
            numSponsoring,
            numSponsored,
          }),
          symbol: NATIVE_ASSET_SYMBOL,
        };
      } else if (
        balance.asset_type === 'credit_alphanum12' ||
        balance.asset_type === 'credit_alphanum4'
      ) {
        const authorized = balance.is_authorized ?? true;
        const assetId = toCaip19ClassicAssetId(
          scope,
          balance.asset_code,
          balance.asset_issuer,
        );
        const limit = toSmallestUnit(new BigNumber(balance.limit ?? 0));
        const sponsorId =
          'sponsor' in balance &&
          typeof (balance as { sponsor?: string }).sponsor === 'string'
            ? (balance as { sponsor?: string }).sponsor
            : undefined;
        const sponsored = sponsorId !== undefined && sponsorId.length > 0;
        balances[assetId] = {
          balance: balanceStroops,
          symbol: balance.asset_code,
          address: balance.asset_issuer,
          limit,
          authorized,
          ...(sponsored ? { sponsored: true } : {}),
        };
      }
    }

    const data: OnChainAccountSerializable = {
      accountId: response.accountId(),
      sequenceNumber: response.sequenceNumber(),
      scope,
      meta,
      balances,
    };

    return new OnChainAccount(stellarAccount, scope, data);
  }

  /**
   * Rehydrates from {@link OnChainAccountSerializable} (inverse of {@link OnChainAccount#toSerializable}).
   *
   * Native slip44 `balance` in the payload is **spendable** stroops; raw total is recovered as spendable + minimum balance from `meta`.
   *
   * @param data - Plain snapshot from {@link OnChainAccount#toSerializable}.
   * @returns Bound {@link OnChainAccount} for the same network and balances.
   * @throws {@link OnChainAccountException} When the native slip44 row for `data.scope` is missing.
   */
  static fromSerializable(data: OnChainAccountSerializable): OnChainAccount {
    // Safe guard to ensure the native balance is present.
    const nativeId = getSlip44AssetId(data.scope);
    if (data.balances[nativeId] === undefined) {
      throw new OnChainAccountException(
        `Serializable data for ${data.accountId} is missing native balance (${nativeId})`,
      );
    }
    const stellarAccount = new StellarAccount(
      data.accountId,
      data.sequenceNumber,
    );
    return new OnChainAccount(stellarAccount, data.scope, data);
  }

  #bindFromSerializable(data: OnChainAccountSerializable): void {
    const { meta, balances: rows, scope } = data;
    this.#subentryCount = meta.subentryCount;
    this.#numSponsoring = meta.numSponsoring;
    this.#numSponsored = meta.numSponsored;

    const nativeId = getSlip44AssetId(scope);

    for (const [assetId, row] of entries(rows)) {
      if (assetId === nativeId) {
        this.#balances.set(nativeId, {
          balance: row.balance,
          symbol: row.symbol,
        });
      } else if (isClassicAssetId(assetId) && row.limit !== undefined) {
        this.#balances.set(assetId, {
          balance: row.balance,
          symbol: row.symbol,
          limit: row.limit,
          ...(row.address === undefined ? {} : { address: row.address }),
          ...(row.authorized === undefined
            ? {}
            : { authorized: row.authorized }),
          ...(row.sponsored === undefined ? {} : { sponsored: row.sponsored }),
        });
      } else if (isSep41Id(assetId)) {
        this.#balances.set(assetId, {
          balance: row.balance,
          symbol: row.symbol,
        });
      }
    }

    // we only store spendable balance in the balances map,
    // so we need to add the reserved balance to get the raw balance
    const nativeSpendable = this.#balances.get(nativeId)?.balance;
    if (nativeSpendable !== undefined) {
      this.#rawNativeBalance = nativeSpendable.plus(
        minimumBalanceStroops(meta),
      );
    }
  }
}
