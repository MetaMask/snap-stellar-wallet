import type { Json } from '@metamask/utils';
import type { Asset, Operation } from '@stellar/stellar-sdk';
import { LiquidityPoolAsset, LiquidityPoolId, xdr } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import { StellarOperationType } from './api';
import type { Transaction } from './Transaction';
import {
  getAddress,
  getFunctionName,
  parseScValToReadableJson,
} from './xdrParser';
import type { KnownCaip2ChainId } from '../../api';
import { bufferToUint8Array } from '../../utils';

/**
 * Semantic hint for how a confirmation row should be rendered.
 */
export const FieldType = {
  address: 'address',
  asset: 'asset',
  assetWithAmount: 'assetWithAmount',
  amount: 'amount',
  price: 'price',
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  json: 'json',
  copyable: 'copyable',
} as const;

export type FieldType = (typeof FieldType)[keyof typeof FieldType];

/**
 * One labeled value row for operation confirmation UI.
 */
export type ReadableOperationField = {
  key: string;
  value: Json;
  type: FieldType;
};

/**
 * One operation turned into plain data for UX or `JSON.stringify`.
 */
export type ReadableOperationJson = {
  index: number;
  type: string;
  /**
   * Resolved source account for this operation (`G…`): Stellar `operation.source` when set,
   * otherwise the transaction source (same rule as the SDK).
   */
  source: string;
  /**
   * Raw optional `source` from the Stellar operation; `null` when the op inherits the
   * transaction source (not set on the XDR).
   */
  explicitSource: string | null;
  /** `false` for Soroban footprint / host ops (not expanded here). */
  classic: boolean;
  /** Ordered rows for UX; each row has a stable `key` and semantic `type` for formatting. */
  params: ReadableOperationField[];
};

/**
 * One Soroban authorization entry for the confirmation dialog (own section,
 * parallel to {@link ReadableOperationJson} for `invokeHostFunction`).
 */
export type ReadableAuthorizationJson = {
  params: ReadableAuthorizationParams[];
};

export type ReadableAuthorizationParams = ReadableOperationField & {
  key: 'authorizedAddress' | 'contractId' | 'functionName' | 'arguments';
};

/**
 * Transaction-level envelope plus per-operation summaries.
 */
export type ReadableTransactionJson = {
  scope: KnownCaip2ChainId;
  feeStroops: string;
  operationCount: number;
  sourceAccount: string;
  feeSourceAccount: string;
  memo: string | null;
  operations: ReadableOperationJson[];
  /**
   * Auth entries from `invokeHostFunction` ops. Rendered as a separate
   * "Authorizations" section — not nested under the host-function params.
   */
  authorizations: ReadableAuthorizationJson[];
};

const SOROBAN_OPERATION_TYPES = new Set<string>([
  StellarOperationType.InvokeHostFunction,
  StellarOperationType.ExtendFootprintTtl,
  StellarOperationType.RestoreFootprint,
]);

/** Stellar account auth flags for {@link Operation.setOptions} `setFlags` / `clearFlags`. */
const ACCOUNT_AUTH_FLAG_MASKS: readonly { mask: number; label: string }[] = [
  { mask: 1, label: 'authRequired' },
  { mask: 2, label: 'authRevocable' },
  { mask: 4, label: 'authImmutable' },
  { mask: 8, label: 'authClawbackEnabled' },
];

/* eslint-disable no-bitwise -- Stellar AuthFlags are a uint32 bitmask */
const KNOWN_ACCOUNT_AUTH_FLAGS_MASK = ACCOUNT_AUTH_FLAG_MASKS.reduce(
  (acc, { mask }) => acc | mask,
  0,
);

/**
 * Turns a `setFlags` / `clearFlags` uint32 bitmask into comma-separated labels for UX.
 *
 * @param flags - Raw flag bits from the operation.
 * @returns Labels, or `none` when the mask is zero; unknown bits become `unknown(0x…)`.
 */
function accountAuthFlagsMaskToText(flags: number): string[] {
  const bits = flags >>> 0;
  const parts: string[] = [];
  for (const { mask, label } of ACCOUNT_AUTH_FLAG_MASKS) {
    if ((bits & mask) !== 0) {
      parts.push(label);
    }
  }
  const unknown = bits & ~KNOWN_ACCOUNT_AUTH_FLAGS_MASK;
  if (unknown !== 0) {
    parts.push(`unknown(0x${unknown.toString(16)})`);
  }
  return parts;
}
/* eslint-enable no-bitwise */

/**
 * Abstract class for mapping operations to readable JSON.
 */
class AbstractOperationMapper {
  protected field(
    key: string,
    value: Json,
    type: FieldType,
  ): ReadableOperationField {
    let normalizedValue: Json = value;
    if (type === FieldType.amount) {
      normalizedValue = this.normalizeAmount(value);
    } else if (type === FieldType.assetWithAmount && Array.isArray(value)) {
      const [asset, amount] = value as [Json, Json];
      normalizedValue = [asset, this.normalizeAmount(amount)];
    }
    return { key, value: normalizedValue, type };
  }

  protected normalizeAmount(value: Json): Json {
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value)) {
      return new BigNumber(value).toFixed();
    }
    return value;
  }
}

export class AuthorizationMapper extends AbstractOperationMapper {
  /**
   * Collects Soroban auth entries into dialog sections (root invocation +
   * nested sub-invocations flattened).
   *
   * @param entries - Soroban authorization entries from `invokeHostFunction`.
   * @returns Authorization summaries for the confirmation UI.
   */
  mapAuthorizations(
    entries: readonly xdr.SorobanAuthorizationEntry[],
  ): ReadableAuthorizationJson[] {
    const authorizations: ReadableAuthorizationJson[] = [];
    for (const entry of entries) {
      try {
        authorizations.push(
          ...this.mapInvocation(
            entry.rootInvocation(),
            this.#getAuthAddress(entry),
          ),
        );
      } catch {
        // Skip malformed auth entries; host-function section still renders.
      }
    }
    return authorizations;
  }

  /**
   * Maps one authorized invocation tree into flat confirmation sections.
   * Used by transaction auth entries and SEP-43 `signAuthEntry` preimages.
   *
   * @param invocation - Root or nested `SorobanAuthorizedInvocation`.
   * @param authAddress - Credential address when known; otherwise `null`.
   * @returns One section per invocation (root first, then depth-first subs).
   */
  mapInvocation(
    invocation: xdr.SorobanAuthorizedInvocation,
    authAddress: string | null = null,
  ): ReadableAuthorizationJson[] {
    const authorizations: ReadableAuthorizationJson[] = [];
    this.#appendInvocationAuthorizations(
      authorizations,
      invocation,
      authAddress,
    );
    return authorizations;
  }

  #appendInvocationAuthorizations(
    authorizations: ReadableAuthorizationJson[],
    invocation: xdr.SorobanAuthorizedInvocation,
    authAddress: string | null,
  ): void {
    const params = this.#mapAuthorizedInvocationParams(
      invocation,
      authAddress,
    ) as ReadableAuthorizationParams[];

    if (params.length > 0) {
      authorizations.push({ params });
    }
    for (const sub of invocation.subInvocations()) {
      this.#appendInvocationAuthorizations(authorizations, sub, authAddress);
    }
  }

  #mapAuthorizedInvocationParams(
    invocation: xdr.SorobanAuthorizedInvocation,
    authAddress: string | null,
  ): ReadableOperationField[] {
    const rows: ReadableOperationField[] = [];
    if (authAddress !== null) {
      rows.push(
        this.field('authorizedAddress', authAddress, FieldType.copyable),
      );
    }

    const fn = invocation.function();
    switch (fn.switch()) {
      case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn(): {
        const contractFn = fn.contractFn();
        rows.push(
          this.field(
            'contractId',
            getAddress(contractFn.contractAddress()),
            FieldType.copyable,
          ),
        );
        rows.push(
          this.field(
            'functionName',
            getFunctionName(contractFn.functionName()),
            FieldType.text,
          ),
        );
        const args = contractFn.args();
        if (args.length > 0) {
          rows.push(
            this.field(
              'arguments',
              args.map((arg) => parseScValToReadableJson(arg)),
              FieldType.json,
            ),
          );
        }
        break;
      }
      case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeCreateContractHostFn():
        rows.push(this.field('functionName', 'createContract', FieldType.text));
        break;
      case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeCreateContractV2HostFn():
        rows.push(
          this.field('functionName', 'createContractV2', FieldType.text),
        );
        break;
      default:
        rows.push(this.field('functionName', 'authorization', FieldType.text));
    }
    return rows;
  }

  #getAuthAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
    const credentials = entry.credentials();
    if (
      credentials.switch() !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress()
    ) {
      return null;
    }
    return getAddress(credentials.address().address());
  }
}

/**
 * Maps Stellar {@link Operation} values to plain JSON-friendly objects for signing UX.
 */
export class OperationMapper extends AbstractOperationMapper {
  /**
   * Builds a readable summary for every operation in the wrapped transaction.
   *
   * @param transaction - Snap {@link Transaction} wrapper.
   * @returns Serializable summary.
   */
  mapTransaction(transaction: Transaction): ReadableTransactionJson {
    const { sourceAccount } = transaction;
    const operations = transaction.transactionOperations.map(
      (sdkOperation, index) =>
        this.#mapOperation(sdkOperation, index, sourceAccount),
    );
    const authorizations = this.#mapAuthorizations(
      transaction.transactionOperations,
    );
    return {
      scope: transaction.scope,
      feeStroops: transaction.totalFee.toFixed(0),
      operationCount: operations.length,
      sourceAccount,
      feeSourceAccount: transaction.feeSourceAccount,
      memo: transaction.getMemo(),
      operations,
      authorizations,
    };
  }

  #mapAuthorizations(
    operations: readonly Operation[],
  ): ReadableAuthorizationJson[] {
    const authMapper = new AuthorizationMapper();
    const authorizations: ReadableAuthorizationJson[] = [];
    for (const operation of operations) {
      if (operation.type !== StellarOperationType.InvokeHostFunction) {
        continue;
      }
      const { auth } = operation;
      if (!auth || auth.length === 0) {
        continue;
      }
      authorizations.push(...authMapper.mapAuthorizations(auth));
    }
    return authorizations;
  }

  /**
   * Maps a single SDK operation.
   *
   * @param operation - Stellar SDK operation.
   * @param index - Zero-based index in the transaction.
   * @param transactionSource - Transaction source when `operation.source` is omitted.
   * @returns Serializable operation summary.
   */
  #mapOperation(
    operation: Operation,
    index: number,
    transactionSource: string,
  ): ReadableOperationJson {
    const { type } = operation;
    const classic = !SOROBAN_OPERATION_TYPES.has(type);
    const explicitSource = operation.source ?? null;
    const source = operation.source ?? transactionSource;

    return {
      index,
      type,
      source,
      explicitSource,
      classic,
      params: classic
        ? this.#mapClassicParams(operation)
        : this.#mapSorobanPlaceholder(operation),
    };
  }

  #mapSorobanPlaceholder(operation: Operation): ReadableOperationField[] {
    if (operation.type === StellarOperationType.InvokeHostFunction) {
      const hostOp = operation;
      const rows: ReadableOperationField[] = [];
      try {
        const { func } = hostOp;

        if (
          func?.switch() ===
          xdr.HostFunctionType.hostFunctionTypeInvokeContract()
        ) {
          const invokeArgs = func.invokeContract();
          const contractAddress = getAddress(invokeArgs.contractAddress());
          const functionName = getFunctionName(invokeArgs.functionName());
          rows.push(
            this.field('contractId', contractAddress, FieldType.copyable),
          );
          rows.push(this.field('functionName', functionName, FieldType.text));
          const args = invokeArgs.args();
          if (args.length > 0) {
            rows.push(
              this.field(
                'arguments',
                args.map((arg) => parseScValToReadableJson(arg)),
                'json',
              ),
            );
          }
        }
      } catch {
        // Fall through to XDR fallback
      }
      if (rows.length === 0) {
        rows.push(
          this.field(
            'note',
            'Soroban invokeHostFunction; review contract call on a block explorer or dedicated UI.',
            FieldType.text,
          ),
        );
      }
      return rows;
    }
    if (operation.type === StellarOperationType.ExtendFootprintTtl) {
      const extendOp = operation;
      return [this.field('extendTo', extendOp.extendTo, FieldType.number)];
    }
    if (operation.type === StellarOperationType.RestoreFootprint) {
      return [this.field('note', 'Soroban restoreFootprint.', FieldType.text)];
    }
    return [
      this.field(
        'note',
        'Soroban operation; expand separately if needed.',
        FieldType.text,
      ),
    ];
  }

  #mapClassicParams(operation: Operation): ReadableOperationField[] {
    switch (operation.type) {
      case StellarOperationType.Payment: {
        const payment = operation;
        return [
          this.field('destination', payment.destination, FieldType.address),
          this.field(
            'asset',
            [payment.asset.toString(), payment.amount],
            FieldType.assetWithAmount,
          ),
        ];
      }
      case StellarOperationType.CreateAccount: {
        const createAccount = operation;
        return [
          this.field(
            'destination',
            createAccount.destination,
            FieldType.address,
          ),
          this.field(
            'startingBalance',
            createAccount.startingBalance,
            FieldType.amount,
          ),
        ];
      }
      case StellarOperationType.ChangeTrust: {
        const changeTrust = operation;
        return [
          // we don't use assetWithAmount here because the line is not necessarily a classic asset
          // and we are not sending amount here.
          this.field(
            'line',
            this.#formatTrustLine(changeTrust.line),
            FieldType.text,
          ),
          this.field('limit', changeTrust.limit, FieldType.amount),
        ];
      }
      case StellarOperationType.AccountMerge: {
        const accountMerge = operation;
        return [
          this.field(
            'destination',
            accountMerge.destination,
            FieldType.address,
          ),
        ];
      }
      case StellarOperationType.PathPaymentStrictReceive: {
        const pathReceive = operation;

        return [
          this.field(
            'sendAsset',
            [pathReceive.sendAsset.toString(), pathReceive.sendMax],
            FieldType.assetWithAmount,
          ),
          this.field('destination', pathReceive.destination, FieldType.address),
          this.field(
            'destAsset',
            [pathReceive.destAsset.toString(), pathReceive.destAmount],
            FieldType.assetWithAmount,
          ),
          this.field(
            'path',
            pathReceive.path.map((asset) => asset.toString()),
            FieldType.json,
          ),
        ];
      }
      case StellarOperationType.PathPaymentStrictSend: {
        const pathSend = operation;
        return [
          this.field(
            'sendAsset',
            [pathSend.sendAsset.toString(), pathSend.sendAmount],
            FieldType.assetWithAmount,
          ),
          this.field('destination', pathSend.destination, FieldType.address),
          this.field(
            'destAsset',
            [pathSend.destAsset.toString(), pathSend.destMin],
            FieldType.assetWithAmount,
          ),

          this.field(
            'path',
            pathSend.path.map((asset) => asset.toString()),
            FieldType.json,
          ),
        ];
      }
      case StellarOperationType.ManageSellOffer: {
        const sellOffer = operation;
        return [
          this.field(
            'selling',
            [sellOffer.selling.toString(), sellOffer.amount],
            FieldType.assetWithAmount,
          ),
          this.field('buying', sellOffer.buying.toString(), FieldType.asset),
          this.field('price', sellOffer.price, FieldType.price),
          this.field('offerId', sellOffer.offerId, FieldType.text),
        ];
      }
      case StellarOperationType.ManageBuyOffer: {
        const buyOffer = operation;
        return [
          this.field(
            'buying',
            [buyOffer.buying.toString(), buyOffer.buyAmount],
            FieldType.assetWithAmount,
          ),
          this.field('selling', buyOffer.selling.toString(), FieldType.asset),
          this.field('price', buyOffer.price, FieldType.price),
          this.field('offerId', buyOffer.offerId, FieldType.text),
        ];
      }
      case StellarOperationType.CreatePassiveSellOffer: {
        const passiveOffer = operation;
        return [
          this.field(
            'selling',
            [passiveOffer.selling.toString(), passiveOffer.amount],
            FieldType.assetWithAmount,
          ),
          this.field('buying', passiveOffer.buying.toString(), FieldType.asset),
          this.field('price', passiveOffer.price, FieldType.price),
        ];
      }
      case StellarOperationType.SetOptions: {
        const setOptions = operation;
        const rows: ReadableOperationField[] = [];
        if (setOptions.inflationDest !== undefined) {
          rows.push(
            this.field(
              'inflationDest',
              setOptions.inflationDest,
              FieldType.address,
            ),
          );
        }
        if (setOptions.clearFlags !== undefined) {
          rows.push(
            this.field(
              'clearFlags',
              accountAuthFlagsMaskToText(setOptions.clearFlags),
              FieldType.text,
            ),
          );
        }
        if (setOptions.setFlags !== undefined) {
          rows.push(
            this.field(
              'setFlags',
              accountAuthFlagsMaskToText(setOptions.setFlags),
              FieldType.text,
            ),
          );
        }
        if (setOptions.masterWeight !== undefined) {
          rows.push(
            this.field(
              'masterWeight',
              setOptions.masterWeight,
              FieldType.number,
            ),
          );
        }
        if (setOptions.lowThreshold !== undefined) {
          rows.push(
            this.field(
              'lowThreshold',
              setOptions.lowThreshold,
              FieldType.number,
            ),
          );
        }
        if (setOptions.medThreshold !== undefined) {
          rows.push(
            this.field(
              'medThreshold',
              setOptions.medThreshold,
              FieldType.number,
            ),
          );
        }
        if (setOptions.highThreshold !== undefined) {
          rows.push(
            this.field(
              'highThreshold',
              setOptions.highThreshold,
              FieldType.number,
            ),
          );
        }
        if (setOptions.homeDomain !== undefined) {
          rows.push(
            this.field('homeDomain', setOptions.homeDomain, FieldType.text),
          );
        }
        if ('signer' in setOptions && setOptions.signer !== undefined) {
          // SDK Signer is a union of disjoint interfaces; cast to Record for key-based branching.
          const signer = setOptions.signer as unknown as Record<
            string,
            unknown
          >;
          if ('ed25519PublicKey' in signer) {
            rows.push(
              this.field(
                'signerEd25519',
                signer.ed25519PublicKey as string,
                FieldType.address,
              ),
            );
          } else if ('sha256Hash' in signer) {
            rows.push(
              this.field(
                'signerSha256Hash',
                bufferToUint8Array(signer.sha256Hash as Buffer).toString('hex'),
                FieldType.text,
              ),
            );
          } else if ('preAuthTx' in signer) {
            rows.push(
              this.field(
                'signerPreAuthTx',
                bufferToUint8Array(signer.preAuthTx as Buffer).toString('hex'),
                FieldType.text,
              ),
            );
          } else if ('ed25519SignedPayload' in signer) {
            rows.push(
              this.field(
                'signerSignedPayload',
                signer.ed25519SignedPayload as string,
                FieldType.text,
              ),
            );
          }
          if (signer.weight !== undefined) {
            rows.push(
              this.field(
                'signerWeight',
                Number(signer.weight),
                FieldType.number,
              ),
            );
          }
        }
        return rows;
      }
      case StellarOperationType.AllowTrust: {
        const allowTrustOp = operation;
        const rows: ReadableOperationField[] = [
          this.field('trustor', allowTrustOp.trustor, FieldType.address),
          this.field('assetCode', allowTrustOp.assetCode, FieldType.text),
        ];
        if (allowTrustOp.authorize !== undefined) {
          const auth = allowTrustOp.authorize;
          if (typeof auth === 'boolean') {
            rows.push(this.field('authorize', auth, FieldType.boolean));
          } else {
            rows.push(this.field('authorize', String(auth), FieldType.text));
          }
        }
        return rows;
      }
      case StellarOperationType.ManageData: {
        const manageDataOp = operation;
        return [
          this.field('name', manageDataOp.name, FieldType.text),
          this.field(
            'valueBase64',
            manageDataOp.value
              ? bufferToUint8Array(manageDataOp.value).toString('base64')
              : null,
            FieldType.text,
          ),
        ];
      }
      case StellarOperationType.BumpSequence: {
        const bumpSequence = operation;
        return [this.field('bumpTo', bumpSequence.bumpTo, FieldType.text)];
      }
      case StellarOperationType.Inflation:
        return [];
      case StellarOperationType.CreateClaimableBalance: {
        const createCb = operation;
        return [
          this.field(
            'asset',
            [createCb.asset.toString(), createCb.amount],
            FieldType.assetWithAmount,
          ),
          this.field(
            'claimants',
            createCb.claimants.map((claimant) => ({
              destination: claimant.destination,
              predicate: this.#formatPredicate(claimant.predicate),
            })),
            FieldType.json,
          ),
        ];
      }
      case StellarOperationType.ClaimClaimableBalance: {
        const claimCb = operation;
        return [this.field('balanceId', claimCb.balanceId, FieldType.text)];
      }
      case StellarOperationType.BeginSponsoringFutureReserves: {
        const beginSponsor = operation;
        return [
          this.field(
            'sponsoredId',
            beginSponsor.sponsoredId,
            FieldType.address,
          ),
        ];
      }
      case StellarOperationType.EndSponsoringFutureReserves:
        return [];
      case StellarOperationType.RevokeSponsorship:
        return this.#mapRevokeSponsorship(operation);
      case StellarOperationType.Clawback: {
        const clawback = operation;
        return [
          this.field(
            'asset',
            [clawback.asset.toString(), clawback.amount],
            FieldType.assetWithAmount,
          ),
          this.field('from', clawback.from, FieldType.address),
        ];
      }
      case StellarOperationType.ClawbackClaimableBalance: {
        const clawbackCb = operation;
        return [this.field('balanceId', clawbackCb.balanceId, FieldType.text)];
      }
      case StellarOperationType.SetTrustLineFlags: {
        const trustFlags = operation;
        const setFlagLabels: string[] = [];
        const clearFlagLabels: string[] = [];
        if (trustFlags.flags.authorized === true) {
          setFlagLabels.push('authorized');
        } else if (trustFlags.flags.authorized === false) {
          clearFlagLabels.push('authorized');
        }
        if (trustFlags.flags.authorizedToMaintainLiabilities === true) {
          setFlagLabels.push('authorizedToMaintainLiabilities');
        } else if (trustFlags.flags.authorizedToMaintainLiabilities === false) {
          clearFlagLabels.push('authorizedToMaintainLiabilities');
        }
        if (trustFlags.flags.clawbackEnabled === true) {
          setFlagLabels.push('clawbackEnabled');
        } else if (trustFlags.flags.clawbackEnabled === false) {
          clearFlagLabels.push('clawbackEnabled');
        }
        const rows: ReadableOperationField[] = [
          this.field('trustor', trustFlags.trustor, FieldType.address),
          this.field('asset', trustFlags.asset.toString(), FieldType.asset),
        ];
        if (setFlagLabels.length > 0) {
          rows.push(this.field('setFlags', setFlagLabels, FieldType.text));
        }
        if (clearFlagLabels.length > 0) {
          rows.push(this.field('clearFlags', clearFlagLabels, FieldType.text));
        }
        return rows;
      }
      case StellarOperationType.LiquidityPoolDeposit: {
        const poolDeposit = operation;
        return [
          this.field(
            'liquidityPoolId',
            poolDeposit.liquidityPoolId,
            FieldType.text,
          ),
          this.field('maxAmountA', poolDeposit.maxAmountA, FieldType.amount),
          this.field('maxAmountB', poolDeposit.maxAmountB, FieldType.amount),
          this.field('minPrice', poolDeposit.minPrice, FieldType.price),
          this.field('maxPrice', poolDeposit.maxPrice, FieldType.price),
        ];
      }
      case StellarOperationType.LiquidityPoolWithdraw: {
        const poolWithdraw = operation;
        return [
          this.field(
            'liquidityPoolId',
            poolWithdraw.liquidityPoolId,
            FieldType.text,
          ),
          this.field('amount', poolWithdraw.amount, FieldType.amount),
          this.field('minAmountA', poolWithdraw.minAmountA, FieldType.amount),
          this.field('minAmountB', poolWithdraw.minAmountB, FieldType.amount),
        ];
      }
      case StellarOperationType.InvokeHostFunction:
      case StellarOperationType.ExtendFootprintTtl:
      case StellarOperationType.RestoreFootprint:
        return [
          this.field(
            'note',
            'Soroban operation; use non-classic mapping path.',
            FieldType.text,
          ),
        ];
      default: {
        return [
          this.field(
            'note',
            `Unhandled or newer operation type.`,
            FieldType.text,
          ),
        ];
      }
    }
  }

  #mapRevokeSponsorship(operation: Operation): ReadableOperationField[] {
    if ('seller' in operation && 'offerId' in operation) {
      const revokeOffer = operation as {
        seller: string;
        offerId: string;
      };
      return [
        this.field('seller', revokeOffer.seller, 'address'),
        this.field('offerId', revokeOffer.offerId, 'text'),
      ];
    }
    if ('balanceId' in operation && !('account' in operation)) {
      const revokeCb = operation as { balanceId: string };
      return [this.field('balanceId', revokeCb.balanceId, 'text')];
    }
    if ('liquidityPoolId' in operation && !('account' in operation)) {
      const revokePool = operation as { liquidityPoolId: string };
      return [
        this.field('liquidityPoolId', revokePool.liquidityPoolId, 'text'),
      ];
    }
    if ('account' in operation && 'name' in operation) {
      const revokeData = operation as { account: string; name: string };
      return [
        this.field('account', revokeData.account, 'address'),
        this.field('name', revokeData.name, 'text'),
      ];
    }
    if ('account' in operation && 'signer' in operation) {
      const revokeSigner = operation as {
        account: string;
        signer: unknown;
      };
      return [
        this.field('account', revokeSigner.account, 'address'),
        this.field('signer', JSON.stringify(revokeSigner.signer), 'text'),
      ];
    }
    if ('account' in operation && 'asset' in operation) {
      const revokeTrust = operation as {
        account: string;
        asset: Asset | LiquidityPoolId;
      };
      const { asset } = revokeTrust;
      const assetLabel =
        asset instanceof LiquidityPoolId
          ? asset.getLiquidityPoolId()
          : asset.toString();
      return [
        this.field('account', revokeTrust.account, 'address'),
        this.field('asset', assetLabel, 'asset'),
      ];
    }
    if ('account' in operation) {
      const revokeAccount = operation as { account: string };
      return [this.field('account', revokeAccount.account, 'address')];
    }
    return [
      this.field('note', 'revokeSponsorship shape not recognized.', 'text'),
    ];
  }

  #formatTrustLine(line: Asset | LiquidityPoolAsset): string {
    if (line instanceof LiquidityPoolAsset) {
      return `${line.assetA.toString()} / ${line.assetB.toString()} (LP fee ${line.fee})`;
    }
    return line.toString();
  }

  #formatPredicate(predicate: xdr.ClaimPredicate): string {
    try {
      const type = predicate.switch();
      if (type === xdr.ClaimPredicateType.claimPredicateUnconditional()) {
        return 'unconditional';
      }
      if (type === xdr.ClaimPredicateType.claimPredicateBeforeAbsoluteTime()) {
        const absBeforeVal = predicate.absBefore();
        const seconds = Number(absBeforeVal.toXDR().readBigInt64BE(0));
        return `before ${new Date(seconds * 1000).toISOString()}`;
      }
      if (type === xdr.ClaimPredicateType.claimPredicateBeforeRelativeTime()) {
        const relBeforeVal = predicate.relBefore();
        return `within ${String(relBeforeVal)}s`;
      }
      if (type === xdr.ClaimPredicateType.claimPredicateAnd()) {
        const preds = predicate.andPredicates();
        const left = preds[0];
        const right = preds[1];
        if (left && right) {
          return `(${this.#formatPredicate(left)} AND ${this.#formatPredicate(right)})`;
        }
      }
      if (type === xdr.ClaimPredicateType.claimPredicateOr()) {
        const preds = predicate.orPredicates();
        const left = preds[0];
        const right = preds[1];
        if (left && right) {
          return `(${this.#formatPredicate(left)} OR ${this.#formatPredicate(right)})`;
        }
      }
      if (type === xdr.ClaimPredicateType.claimPredicateNot()) {
        const inner = predicate.notPredicate();
        return inner ? `NOT ${this.#formatPredicate(inner)}` : 'NOT(null)';
      }
    } catch {
      // Fall through
    }
    return 'unknown predicate';
  }
}
