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
  KnownCaip2ChainId,
} from '../../api';
import { NATIVE_ASSET_SYMBOL } from '../../constants';
import {
  getSlip44AssetId,
  isClassicAssetId,
  isSep41Id,
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
   * @returns A shallow copy of the row, or `undefined` when this account has no balance for the id.
   */
  getAsset(
    assetId: KnownCaip19AssetIdOrSlip44Id,
  ): SpendableBalance | undefined {
    const entry = this.#balances.get(assetId);
    if (entry === undefined) {
      return undefined;
    }
    return { ...entry };
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

  /**
   * Native (XLM) balance available to spend after minimum reserve and trustline reserves, in stroops.
   * Sourced from the bound native slip44 row (set on full bind from `rawNativeBalance` + meta).
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
   * Full snapshots put native total in `rawNativeBalance` (stroops string); `balances` is only store non-native rows (classic + SEP-41), each with string numerics for JSON.
   *
   * @returns Full or minimal serializable shape for this binding.
   */
  toSerializable(): OnChainAccountSerializable {
    const subentryCount = this.#subentryCount;
    const numSponsoring = this.#numSponsoring;
    const numSponsored = this.#numSponsored;

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
            `Classic balance row missing limit for asset ${assetId}`,
          );
        }
        if (entry.address === undefined) {
          throw new OnChainAccountException(
            `Classic balance row missing address for asset ${assetId}`,
          );
        }
        if (entry.authorized === undefined) {
          throw new OnChainAccountException(
            `Classic balance row missing authorized for asset ${assetId}`,
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
        balances.push({
          assetId,
          balance: entry.balance.toString(),
          symbol: entry.symbol,
        });
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

  /**
   * Builds from a Horizon `loadAccount` response.
   * With a native balance line → full binding; otherwise → minimal binding (sequence-only style).
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
    const meta = { subentryCount, numSponsoring, numSponsored };
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
      return new OnChainAccount(stellarAccount, scope, {
        accountId: response.accountId(),
        sequenceNumber: response.sequenceNumber(),
        scope,
      });
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
      const { meta, balances: rows, scope } = data;
      this.#subentryCount = meta.subentryCount;
      this.#numSponsoring = meta.numSponsoring;
      this.#numSponsored = meta.numSponsored;
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

      rows.forEach((row) => {
        // native asset is handled separately above
        if (row.assetId === nativeId) {
          return;
        }
        // check if asset id already exists in the balances map
        if (this.#balances.has(row.assetId)) {
          throw new OnChainAccountException(
            'Asset id already exists in the balances map',
          );
        }

        if (SerializableClassicSpendableBalanceStruct.is(row)) {
          const { balance, symbol, limit, address, authorized, sponsored } =
            row;

          this.#balances.set(row.assetId, {
            balance: new BigNumber(balance),
            symbol,
            limit: new BigNumber(limit),
            address,
            authorized,
            ...(sponsored === undefined ? {} : { sponsored }),
          });
        } else if (SerializableSep41SpendableBalanceStruct.is(row)) {
          const { balance, symbol } = row;
          this.#balances.set(row.assetId, {
            balance: new BigNumber(balance),
            symbol,
          });
        } else {
          throw new OnChainAccountException(
            `Unsupported balance row for asset: ${String(row.assetId)}`,
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
