import type { Json } from '@metamask/utils';
import type { Asset, Operation } from '@stellar/stellar-sdk';
import { LiquidityPoolAsset, LiquidityPoolId, xdr } from '@stellar/stellar-sdk';

import type { Transaction } from './Transaction';
import type { KnownCaip2ChainId } from '../../api';
import { bufferToUint8Array } from '../../utils';

/**
 * Semantic hint for how a confirmation row should be rendered.
 */
export type ReadableFieldType =
  | 'address'
  | 'asset'
  | 'assetWithAmount'
  | 'amount'
  | 'price'
  | 'text'
  | 'number'
  | 'boolean'
  | 'json';

/**
 * One labeled value row for operation confirmation UI.
 */
export type ReadableOperationField = {
  key: string;
  value: Json;
  type: ReadableFieldType;
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
};

const SOROBAN_OPERATION_TYPES = new Set<string>([
  'invokeHostFunction',
  'extendFootprintTtl',
  'restoreFootprint',
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
 * Maps Stellar {@link Operation} values to plain JSON-friendly objects for signing UX.
 */
export class OperationMapper {
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
        this.mapOperation(sdkOperation, index, sourceAccount),
    );

    return {
      scope: transaction.scope,
      feeStroops: transaction.totalFee.toFixed(0),
      operationCount: operations.length,
      sourceAccount,
      feeSourceAccount: transaction.feeSourceAccount,
      memo: transaction.getMemo(),
      operations,
    };
  }

  /**
   * Maps a single SDK operation.
   *
   * @param operation - Stellar SDK operation.
   * @param index - Zero-based index in the transaction.
   * @param transactionSource - Transaction source when `operation.source` is omitted.
   * @returns Serializable operation summary.
   */
  mapOperation(
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
    if (operation.type === 'invokeHostFunction') {
      const hostOp = operation;
      const rows: ReadableOperationField[] = [];
      try {
        const { func } = hostOp;
        if (
          func &&
          func.switch() ===
            xdr.HostFunctionType.hostFunctionTypeInvokeContract()
        ) {
          const invokeArgs = func.invokeContract();
          const contractIdHex = bufferToUint8Array(
            invokeArgs.contractAddress().toXDR(),
          )
            .slice(4)
            .toString('hex');
          const functionName = invokeArgs.functionName().toString('utf8');
          rows.push(this.#field('contractId', contractIdHex, 'text'));
          rows.push(this.#field('functionName', functionName, 'text'));
          const args = invokeArgs.args();
          if (args.length > 0) {
            rows.push(
              this.#field(
                'arguments',
                args.map((arg) => arg.toXDR('base64')),
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
          this.#field(
            'note',
            'Soroban invokeHostFunction; review contract call on a block explorer or dedicated UI.',
            'text',
          ),
        );
      }
      return rows;
    }
    if (operation.type === 'extendFootprintTtl') {
      const extendOp = operation;
      return [this.#field('extendTo', extendOp.extendTo, 'number')];
    }
    if (operation.type === 'restoreFootprint') {
      return [this.#field('note', 'Soroban restoreFootprint.', 'text')];
    }
    return [
      this.#field(
        'note',
        'Soroban operation; expand separately if needed.',
        'text',
      ),
    ];
  }

  #mapClassicParams(operation: Operation): ReadableOperationField[] {
    switch (operation.type) {
      case 'payment': {
        const payment = operation;
        return [
          this.#field('destination', payment.destination, 'address'),
          this.#field(
            'asset',
            [payment.asset.toString(), payment.amount],
            'assetWithAmount',
          ),
        ];
      }
      case 'createAccount': {
        const createAccount = operation;
        return [
          this.#field('destination', createAccount.destination, 'address'),
          this.#field(
            'startingBalance',
            createAccount.startingBalance,
            'amount',
          ),
        ];
      }
      case 'changeTrust': {
        const changeTrust = operation;
        return [
          // we don't use assetWithAmount here because the line is not necessarily a classic asset
          // and we are not sending amount here.
          this.#field('line', this.#formatTrustLine(changeTrust.line), 'text'),
          this.#field('limit', changeTrust.limit, 'amount'),
        ];
      }
      case 'accountMerge': {
        const accountMerge = operation;
        return [
          this.#field('destination', accountMerge.destination, 'address'),
        ];
      }
      case 'pathPaymentStrictReceive': {
        const pathReceive = operation;

        return [
          this.#field(
            'sendAsset',
            [pathReceive.sendAsset.toString(), pathReceive.sendMax],
            'assetWithAmount',
          ),
          this.#field('destination', pathReceive.destination, 'address'),
          this.#field(
            'destAsset',
            [pathReceive.destAsset.toString(), pathReceive.destAmount],
            'assetWithAmount',
          ),
          this.#field(
            'path',
            pathReceive.path.map((asset) => asset.toString()),
            'json',
          ),
        ];
      }
      case 'pathPaymentStrictSend': {
        const pathSend = operation;
        return [
          this.#field(
            'sendAsset',
            [pathSend.sendAsset.toString(), pathSend.sendAmount],
            'assetWithAmount',
          ),
          this.#field('destination', pathSend.destination, 'address'),
          this.#field(
            'destAsset',
            [pathSend.destAsset.toString(), pathSend.destMin],
            'assetWithAmount',
          ),

          this.#field(
            'path',
            pathSend.path.map((asset) => asset.toString()),
            'json',
          ),
        ];
      }
      case 'manageSellOffer': {
        const sellOffer = operation;
        return [
          this.#field(
            'selling',
            [sellOffer.selling.toString(), sellOffer.amount],
            'assetWithAmount',
          ),
          this.#field('buying', sellOffer.buying.toString(), 'asset'),
          this.#field('price', sellOffer.price, 'price'),
          this.#field('offerId', sellOffer.offerId, 'text'),
        ];
      }
      case 'manageBuyOffer': {
        const buyOffer = operation;
        return [
          this.#field(
            'buying',
            [buyOffer.buying.toString(), buyOffer.buyAmount],
            'assetWithAmount',
          ),
          this.#field('selling', buyOffer.selling.toString(), 'asset'),
          this.#field('price', buyOffer.price, 'price'),
          this.#field('offerId', buyOffer.offerId, 'text'),
        ];
      }
      case 'createPassiveSellOffer': {
        const passiveOffer = operation;
        return [
          this.#field(
            'selling',
            [passiveOffer.selling.toString(), passiveOffer.amount],
            'assetWithAmount',
          ),
          this.#field('buying', passiveOffer.buying.toString(), 'asset'),
          this.#field('price', passiveOffer.price, 'price'),
        ];
      }
      case 'setOptions': {
        const setOptions = operation;
        const rows: ReadableOperationField[] = [];
        if (setOptions.inflationDest !== undefined) {
          rows.push(
            this.#field('inflationDest', setOptions.inflationDest, 'address'),
          );
        }
        if (setOptions.clearFlags !== undefined) {
          rows.push(
            this.#field(
              'clearFlags',
              accountAuthFlagsMaskToText(setOptions.clearFlags),
              'text',
            ),
          );
        }
        if (setOptions.setFlags !== undefined) {
          rows.push(
            this.#field(
              'setFlags',
              accountAuthFlagsMaskToText(setOptions.setFlags),
              'text',
            ),
          );
        }
        if (setOptions.masterWeight !== undefined) {
          rows.push(
            this.#field('masterWeight', setOptions.masterWeight, 'number'),
          );
        }
        if (setOptions.lowThreshold !== undefined) {
          rows.push(
            this.#field('lowThreshold', setOptions.lowThreshold, 'number'),
          );
        }
        if (setOptions.medThreshold !== undefined) {
          rows.push(
            this.#field('medThreshold', setOptions.medThreshold, 'number'),
          );
        }
        if (setOptions.highThreshold !== undefined) {
          rows.push(
            this.#field('highThreshold', setOptions.highThreshold, 'number'),
          );
        }
        if (setOptions.homeDomain !== undefined) {
          rows.push(this.#field('homeDomain', setOptions.homeDomain, 'text'));
        }
        if ('signer' in setOptions && setOptions.signer !== undefined) {
          // SDK Signer is a union of disjoint interfaces; cast to Record for key-based branching.
          const signer = setOptions.signer as unknown as Record<
            string,
            unknown
          >;
          if ('ed25519PublicKey' in signer) {
            rows.push(
              this.#field(
                'signerEd25519',
                signer.ed25519PublicKey as string,
                'address',
              ),
            );
          } else if ('sha256Hash' in signer) {
            rows.push(
              this.#field(
                'signerSha256Hash',
                bufferToUint8Array(signer.sha256Hash as Buffer).toString('hex'),
                'text',
              ),
            );
          } else if ('preAuthTx' in signer) {
            rows.push(
              this.#field(
                'signerPreAuthTx',
                bufferToUint8Array(signer.preAuthTx as Buffer).toString('hex'),
                'text',
              ),
            );
          } else if ('ed25519SignedPayload' in signer) {
            rows.push(
              this.#field(
                'signerSignedPayload',
                signer.ed25519SignedPayload as string,
                'text',
              ),
            );
          }
          if (signer.weight !== undefined) {
            rows.push(
              this.#field('signerWeight', Number(signer.weight), 'number'),
            );
          }
        }
        return rows;
      }
      case 'allowTrust': {
        const allowTrustOp = operation;
        const rows: ReadableOperationField[] = [
          this.#field('trustor', allowTrustOp.trustor, 'address'),
          this.#field('assetCode', allowTrustOp.assetCode, 'text'),
        ];
        if (allowTrustOp.authorize !== undefined) {
          const auth = allowTrustOp.authorize;
          if (typeof auth === 'boolean') {
            rows.push(this.#field('authorize', auth, 'boolean'));
          } else {
            rows.push(this.#field('authorize', String(auth), 'text'));
          }
        }
        return rows;
      }
      case 'manageData': {
        const manageDataOp = operation;
        return [
          this.#field('name', manageDataOp.name, 'text'),
          this.#field(
            'valueBase64',
            manageDataOp.value
              ? bufferToUint8Array(manageDataOp.value).toString('base64')
              : null,
            'text',
          ),
        ];
      }
      case 'bumpSequence': {
        const bumpSequence = operation;
        return [this.#field('bumpTo', bumpSequence.bumpTo, 'text')];
      }
      case 'inflation':
        return [];
      case 'createClaimableBalance': {
        const createCb = operation;
        return [
          this.#field(
            'asset',
            [createCb.asset.toString(), createCb.amount],
            'assetWithAmount',
          ),
          this.#field(
            'claimants',
            createCb.claimants.map((claimant) => ({
              destination: claimant.destination,
              predicate: OperationMapper.#formatPredicate(claimant.predicate),
            })),
            'json',
          ),
        ];
      }
      case 'claimClaimableBalance': {
        const claimCb = operation;
        return [this.#field('balanceId', claimCb.balanceId, 'text')];
      }
      case 'beginSponsoringFutureReserves': {
        const beginSponsor = operation;
        return [
          this.#field('sponsoredId', beginSponsor.sponsoredId, 'address'),
        ];
      }
      case 'endSponsoringFutureReserves':
        return [];
      case 'revokeSponsorship':
        return this.#mapRevokeSponsorship(operation);
      case 'clawback': {
        const clawback = operation;
        return [
          this.#field(
            'asset',
            [clawback.asset.toString(), clawback.amount],
            'assetWithAmount',
          ),
          this.#field('from', clawback.from, 'address'),
        ];
      }
      case 'clawbackClaimableBalance': {
        const clawbackCb = operation;
        return [this.#field('balanceId', clawbackCb.balanceId, 'text')];
      }
      case 'setTrustLineFlags': {
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
          this.#field('trustor', trustFlags.trustor, 'address'),
          this.#field('asset', trustFlags.asset.toString(), 'asset'),
        ];
        if (setFlagLabels.length > 0) {
          rows.push(this.#field('setFlags', setFlagLabels, 'text'));
        }
        if (clearFlagLabels.length > 0) {
          rows.push(this.#field('clearFlags', clearFlagLabels, 'text'));
        }
        return rows;
      }
      case 'liquidityPoolDeposit': {
        const poolDeposit = operation;
        return [
          this.#field('liquidityPoolId', poolDeposit.liquidityPoolId, 'text'),
          this.#field('maxAmountA', poolDeposit.maxAmountA, 'amount'),
          this.#field('maxAmountB', poolDeposit.maxAmountB, 'amount'),
          this.#field('minPrice', poolDeposit.minPrice, 'price'),
          this.#field('maxPrice', poolDeposit.maxPrice, 'price'),
        ];
      }
      case 'liquidityPoolWithdraw': {
        const poolWithdraw = operation;
        return [
          this.#field('liquidityPoolId', poolWithdraw.liquidityPoolId, 'text'),
          this.#field('amount', poolWithdraw.amount, 'amount'),
          this.#field('minAmountA', poolWithdraw.minAmountA, 'amount'),
          this.#field('minAmountB', poolWithdraw.minAmountB, 'amount'),
        ];
      }
      case 'invokeHostFunction':
      case 'extendFootprintTtl':
      case 'restoreFootprint':
        return [
          this.#field(
            'note',
            'Soroban operation; use non-classic mapping path.',
            'text',
          ),
        ];
      default: {
        const unknownOp = operation as Operation;
        return [
          this.#field(
            'note',
            `Unhandled or newer operation type "${unknownOp.type}".`,
            'text',
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
        this.#field('seller', revokeOffer.seller, 'address'),
        this.#field('offerId', revokeOffer.offerId, 'text'),
      ];
    }
    if ('balanceId' in operation && !('account' in operation)) {
      const revokeCb = operation as { balanceId: string };
      return [this.#field('balanceId', revokeCb.balanceId, 'text')];
    }
    if ('liquidityPoolId' in operation && !('account' in operation)) {
      const revokePool = operation as { liquidityPoolId: string };
      return [
        this.#field('liquidityPoolId', revokePool.liquidityPoolId, 'text'),
      ];
    }
    if ('account' in operation && 'name' in operation) {
      const revokeData = operation as { account: string; name: string };
      return [
        this.#field('account', revokeData.account, 'address'),
        this.#field('name', revokeData.name, 'text'),
      ];
    }
    if ('account' in operation && 'signer' in operation) {
      const revokeSigner = operation as {
        account: string;
        signer: unknown;
      };
      return [
        this.#field('account', revokeSigner.account, 'address'),
        this.#field('signer', JSON.stringify(revokeSigner.signer), 'text'),
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
        this.#field('account', revokeTrust.account, 'address'),
        this.#field('asset', assetLabel, 'asset'),
      ];
    }
    if ('account' in operation) {
      const revokeAccount = operation as { account: string };
      return [this.#field('account', revokeAccount.account, 'address')];
    }
    return [
      this.#field('note', 'revokeSponsorship shape not recognized.', 'text'),
    ];
  }

  #field(
    key: string,
    value: Json,
    type: ReadableFieldType,
  ): ReadableOperationField {
    return { key, value, type };
  }

  #formatTrustLine(line: Asset | LiquidityPoolAsset): string {
    if (line instanceof LiquidityPoolAsset) {
      return `${line.assetA.toString()} / ${line.assetB.toString()} (LP fee ${line.fee})`;
    }
    return line.toString();
  }

  static #formatPredicate(predicate: xdr.ClaimPredicate): string {
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
          return `(${OperationMapper.#formatPredicate(left)} AND ${OperationMapper.#formatPredicate(right)})`;
        }
      }
      if (type === xdr.ClaimPredicateType.claimPredicateOr()) {
        const preds = predicate.orPredicates();
        const left = preds[0];
        const right = preds[1];
        if (left && right) {
          return `(${OperationMapper.#formatPredicate(left)} OR ${OperationMapper.#formatPredicate(right)})`;
        }
      }
      if (type === xdr.ClaimPredicateType.claimPredicateNot()) {
        const inner = predicate.notPredicate();
        return inner
          ? `NOT ${OperationMapper.#formatPredicate(inner)}`
          : 'NOT(null)';
      }
    } catch {
      // Fall through
    }
    return 'unknown predicate';
  }
}
