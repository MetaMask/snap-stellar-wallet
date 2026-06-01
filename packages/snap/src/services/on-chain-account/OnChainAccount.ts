import type { Horizon } from '@stellar/stellar-sdk';
import { Account as StellarAccount } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { SpendableBalance } from './api';
import {
  OnChainAccountBalanceNotAvailableException,
  OnChainAccountException,
  OnChainAccountMetadataNotAvailableException,
} from './exceptions';
import type {
  OnChainAccountMinimalSerializable,
  OnChainAccountSerializable,
  OnChainAccountSerializableFull,
  SerializableSpendableBalance,
} from './OnChainAccountSerializable';
import {
  OnChainAccountMinimalSerializableStruct,
  OnChainAccountSerializableFullStruct,
  SerializableClassicSpendableBalanceStruct,
  SerializableSep41SpendableBalanceStruct,
} from './OnChainAccountSerializable';
import { calculateSpendableBalance } from './utils';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip2ChainId,
} from '../../api';
import {
  ACCOUNT_REQUIRES_MEMO,
  MEMO_REQUIRED_KEY,
  NATIVE_ASSET_SYMBOL,
} from '../../constants';
import {
  getSlip44AssetId,
  isClassicAssetId,
  isSep41Id,
  isSlip44Id,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../utils';

/**
 * SDK {@link StellarAccount} plus optional {@link OnChainAccountSerializable} hydration.
 * Binding is **either** minimal (`accountId`, `sequenceNumber`, `scope` only) **or** full
 * (meta + balances + `rawNativeBalance`). Build via {@link OnChainAccount.fromHorizon},
 * {@link OnChainAccount.fromSerializable}, or `new OnChainAccount(account, scope)` (no binding).
 */
export class OnChainAccount {
  readonly #account: StellarAccount;

  readonly #scope: KnownCaip2ChainId;

  #subentryCount: number | undefined;

  #numSponsoring: number | undefined;

  #numSponsored: number | undefined;

  #dataEntries: Record<string, string> | undefined;

  #rawNativeBalance: BigNumber | undefined;

  readonly #balances: Map<KnownCaip19AssetIdOrSlip44Id, SpendableBalance> =
    new Map();

  /**
   * @param account - Stellar SDK account (id + sequence). When `binding` is set, header fields must match.
   * @param scope - CAIP-2 network; must match `binding.scope`.
   * @param binding - Minimal or full snapshot; omit for RPC-style accounts (see class overview).
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

  get requiresMemo(): boolean {
    return this.#dataEntries?.[MEMO_REQUIRED_KEY] === ACCOUNT_REQUIRES_MEMO;
  }

  /**
   * Whether the asset is visible for keyring / client flows (active trustline, positive SEP-41, or native).
   *
   * @param assetId - The asset id to check.
   * @returns `true` when {@link getAsset} would return an entry, `false` otherwise.
   */
  hasAsset(assetId: KnownCaip19AssetIdOrSlip44Id): boolean {
    return this.getAsset(assetId) !== undefined;
  }

  /**
   * Visible asset entry for keyring, sends, and trustline UX.
   *
   * Native slip44 entries are always returned when stored. Classic entries require `limit > 0`.
   * SEP-41 entries require `balance > 0`. Tombstones and zero-balance SEP-41 entries are omitted.
   *
   * @param assetId - The asset id to get the balance for.
   * @returns A shallow copy of the entry, or `undefined` when the asset is not visible.
   */
  getAsset(
    assetId: KnownCaip19AssetIdOrSlip44Id,
  ): SpendableBalance | undefined {
    return this.#getVisibleAsset(assetId);
  }

  /**
   * Stored asset entry from the in-memory map, with no visibility filter.
   *
   * Pairs with {@link rawAssetIds}. Use {@link getAsset} for keyring / client flows. Includes
   * tombstones and zero-balance SEP-41 entries that {@link getAsset} omits.
   *
   * @param assetId - The asset id to look up.
   * @returns A shallow copy of the entry, or `undefined` when nothing is stored for the id.
   */
  getRawAsset(
    assetId: KnownCaip19AssetIdOrSlip44Id,
  ): SpendableBalance | undefined {
    const entry = this.#balances.get(assetId);
    if (entry === undefined) {
      return undefined;
    }
    return { ...entry };
  }

  #getVisibleAsset(
    assetId: KnownCaip19AssetIdOrSlip44Id,
  ): SpendableBalance | undefined {
    const entry = this.#balances.get(assetId);
    if (entry === undefined) {
      return undefined;
    }

    if (
      isSlip44Id(assetId) ||
      (isClassicAssetId(assetId) && entry.limit?.gt(0)) ||
      (isSep41Id(assetId) && entry.balance.gt(0))
    ) {
      return { ...entry };
    }

    return undefined;
  }

  /**
   * Sets or replaces a non-native asset entry: SEP-41 contract token or classic trustline
   * (including internal removal tombstones with `limit` 0).
   *
   * @param assetId - SEP-41 or classic CAIP-19 id (not slip44 native).
   * @param assetEntry - Entry stored in the in-memory asset map.
   */
  setAsset(
    assetId: KnownCaip19Sep41AssetId | KnownCaip19ClassicAssetId,
    assetEntry: SpendableBalance,
  ): void {
    this.#balances.set(assetId, assetEntry);
  }

  /**
   * Classic Stellar trustline asset ids (CAIP-19) with a stored entry whose limit is greater than 0.
   *
   * @returns Asset ids for classic trustlines.
   */
  get classicTrustlineAssetIds(): KnownCaip19ClassicAssetId[] {
    const ids: KnownCaip19ClassicAssetId[] = [];
    for (const [assetId, entry] of this.#balances) {
      if (isClassicAssetId(assetId) && entry.limit?.gt(0) === true) {
        ids.push(assetId);
      }
    }
    return ids;
  }

  /**
   * All asset ids stored in the in-memory map, including tombstones and zero-balance SEP-41 entries.
   *
   * @returns Every bound asset id (native slip44 plus non-native entries).
   */
  get rawAssetIds(): KnownCaip19AssetIdOrSlip44Id[] {
    return Array.from(this.#balances.keys());
  }

  /**
   * Asset ids that pass the same visibility rules as {@link getAsset}.
   *
   * @returns Visible asset ids for keyring asset listing.
   */
  get assetIds(): KnownCaip19AssetIdOrSlip44Id[] {
    return Array.from(this.#balances.keys()).filter((assetId) => {
      return this.#getVisibleAsset(assetId) !== undefined;
    });
  }

  /**
   * Native (XLM) balance available to spend after minimum reserve and trustline reserves, in stroops.
   * Sourced from the bound native slip44 entry (set on full bind from `rawNativeBalance` + meta).
   *
   * @returns Spendable native balance in stroops.
   * @throws {OnChainAccountBalanceNotAvailableException} When native balance is not bound.
   */
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

  /**
   * Total native (XLM) balance on the ledger in stroops (Horizon `balance`, not clamped spendable).
   *
   * Sourced from {@link OnChainAccountSerializableFull.rawNativeBalance} on full bind, or from Horizon.
   *
   * @returns Total native balance in stroops.
   * @throws {OnChainAccountBalanceNotAvailableException} When native raw total is not bound.
   */
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
   * Snapshot for persistence: returns a **full** payload when meta and on-ledger native total are
   * bound; otherwise returns a **minimal** payload (`accountId`, `sequenceNumber`, `scope` only).
   * Full snapshots put native total in `rawNativeBalance` (stroops string); `balances` stores non-native asset entries (classic + SEP-41), each with string numerics for JSON.
   *
   * @returns Full or minimal serializable shape for this binding.
   */
  toSerializable(): OnChainAccountSerializable {
    const subentryCount = this.#subentryCount;
    const numSponsoring = this.#numSponsoring;
    const numSponsored = this.#numSponsored;
    const dataEntries = this.#dataEntries ?? {};

    if (
      subentryCount === undefined ||
      numSponsoring === undefined ||
      numSponsored === undefined ||
      this.#rawNativeBalance === undefined
    ) {
      return {
        accountId: this.accountId,
        sequenceNumber: this.sequenceNumber,
        scope: this.#scope,
      };
    }

    const nativeId = getSlip44AssetId(this.#scope);
    const balances: SerializableSpendableBalance[] = [];
    for (const [assetId, entry] of this.#balances) {
      if (assetId === nativeId) {
        continue;
      }
      if (isClassicAssetId(assetId)) {
        if (entry.limit === undefined) {
          throw new OnChainAccountException(
            `Classic asset entry missing limit for asset ${assetId}`,
          );
        }
        if (entry.address === undefined) {
          throw new OnChainAccountException(
            `Classic asset entry missing address for asset ${assetId}`,
          );
        }
        if (entry.authorized === undefined) {
          throw new OnChainAccountException(
            `Classic asset entry missing authorized for asset ${assetId}`,
          );
        }
        balances.push(
          SerializableClassicSpendableBalanceStruct.create({
            assetId,
            balance: entry.balance.toString(),
            symbol: entry.symbol,
            limit: entry.limit.toString(),
            address: entry.address,
            authorized: entry.authorized,
            sponsored: entry.sponsored,
          }),
        );
      } else if (isSep41Id(assetId)) {
        balances.push(
          SerializableSep41SpendableBalanceStruct.create({
            assetId,
            balance: entry.balance.toString(),
            symbol: entry.symbol,
            decimals: entry.decimals,
          }),
        );
      } else {
        throw new OnChainAccountException(`Asset id not supported: ${assetId}`);
      }
    }

    return {
      accountId: this.accountId,
      sequenceNumber: this.sequenceNumber,
      scope: this.#scope,
      meta: {
        subentryCount,
        numSponsoring,
        numSponsored,
        dataEntries,
      },
      balances,
      rawNativeBalance: this.#rawNativeBalance.toFixed(0),
    };
  }

  /**
   * Header-only snapshot for minimally bound accounts.
   *
   * @returns `accountId`, `sequenceNumber`, and `scope`.
   */
  toMinimalSerializable(): OnChainAccountMinimalSerializable {
    return {
      accountId: this.accountId,
      sequenceNumber: this.sequenceNumber,
      scope: this.#scope,
    };
  }

  toSerializableFull(): OnChainAccountSerializableFull {
    const serialized = this.toSerializable();
    if (!OnChainAccountSerializableFullStruct.is(serialized)) {
      throw new OnChainAccountException('Account is not fully hydrated');
    }
    return serialized;
  }

  /**
   * Builds from a Horizon `loadAccount` response.
   * With a native balance line → full binding (includes `data_attr` as `meta.dataEntries`);
   *
   * @param response - Horizon `loadAccount` payload.
   * @param scope - CAIP-2 network.
   * @returns Hydrated {@link OnChainAccount}.
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
    const dataEntries = response.data_attr ?? {};
    const meta = { subentryCount, numSponsoring, numSponsored, dataEntries };
    const balances: SerializableSpendableBalance[] = [];

    const horizonBalances = response.balances ?? [];

    let rawNativeBalance: string | undefined;

    for (const balance of horizonBalances) {
      const balanceStroops = toSmallestUnit(new BigNumber(balance.balance));
      if (balance.asset_type === 'native') {
        rawNativeBalance = balanceStroops.toFixed(0);
        // native asset is handled with rawNativeBalance field
        continue;
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
        balances.push({
          assetId,
          balance: balanceStroops.toString(),
          symbol: balance.asset_code,
          address: balance.asset_issuer,
          limit: limit.toString(),
          authorized,
          ...(sponsored ? { sponsored: true } : {}),
        });
      }
    }

    if (rawNativeBalance === undefined) {
      // this should never happen,
      // as any account that exists on the ledger has a native (XLM) balance line
      throw new OnChainAccountException('Native balance is not available');
    }

    const data: OnChainAccountSerializableFull = {
      accountId: response.accountId(),
      sequenceNumber: response.sequenceNumber(),
      scope,
      meta,
      balances,
      rawNativeBalance,
    };

    return new OnChainAccount(stellarAccount, scope, data);
  }

  /**
   * Rehydrates from {@link OnChainAccountSerializable} (minimal or full).
   *
   * @param data - Minimal header or full snapshot.
   * @returns Bound {@link OnChainAccount}.
   * @throws {@link OnChainAccountException} When the payload is neither minimal nor full.
   */
  static fromSerializable(data: OnChainAccountSerializable): OnChainAccount {
    const stellarAccount = new StellarAccount(
      data.accountId,
      data.sequenceNumber,
    );
    return new OnChainAccount(stellarAccount, data.scope, data);
  }

  #bindFromSerializable(data: OnChainAccountSerializable): void {
    if (OnChainAccountSerializableFullStruct.is(data)) {
      const { meta, balances: assetEntries, scope } = data;
      this.#subentryCount = meta.subentryCount;
      this.#numSponsoring = meta.numSponsoring;
      this.#numSponsored = meta.numSponsored;
      this.#dataEntries = meta.dataEntries ?? {};
      this.#rawNativeBalance = new BigNumber(data.rawNativeBalance);

      const nativeId = getSlip44AssetId(scope);

      this.#balances.set(nativeId, {
        balance: calculateSpendableBalance({
          nativeBalance: this.#rawNativeBalance,
          subentryCount: meta.subentryCount,
          numSponsoring: meta.numSponsoring,
          numSponsored: meta.numSponsored,
        }),
        symbol: NATIVE_ASSET_SYMBOL,
      });

      assetEntries.forEach((assetEntry) => {
        // native asset is handled separately above
        if (assetEntry.assetId === nativeId) {
          return;
        }
        // check if asset id already exists in the balances map
        if (this.#balances.has(assetEntry.assetId)) {
          throw new OnChainAccountException(
            'Asset id already exists in the balances map',
          );
        }

        if (SerializableClassicSpendableBalanceStruct.is(assetEntry)) {
          const { balance, symbol, limit, address, authorized, sponsored } =
            assetEntry;
          this.#balances.set(assetEntry.assetId, {
            balance: new BigNumber(balance),
            symbol,
            limit: new BigNumber(limit),
            address,
            authorized,
            ...(sponsored === undefined ? {} : { sponsored }),
          });
        } else if (SerializableSep41SpendableBalanceStruct.is(assetEntry)) {
          const { balance, symbol, decimals } =
            SerializableSep41SpendableBalanceStruct.create(assetEntry);
          this.#balances.set(assetEntry.assetId, {
            balance: new BigNumber(balance),
            symbol,
            decimals,
          });
        } else {
          throw new OnChainAccountException(
            `Unsupported asset entry for asset: ${String(assetEntry.assetId)}`,
          );
        }
      });
      return;
    }

    if (!OnChainAccountMinimalSerializableStruct.is(data)) {
      throw new OnChainAccountException(
        'Binding must be minimal (accountId, sequenceNumber, scope only) or full (meta, balances, rawNativeBalance)',
      );
    }
  }
}
