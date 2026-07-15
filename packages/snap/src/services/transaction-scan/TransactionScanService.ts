import { BigNumber } from 'bignumber.js';

import {
  AssetChangeDirection,
  StellarClassicAssetDetailsStruct,
  StellarNativeAssetDetailsStruct,
  StellarSep41AssetDetailsStruct,
  TransactionScanErrorId,
  TransactionScanOption,
} from './api';
import type {
  StellarAssetDiff,
  StellarTransactionScanResponse,
  TransactionScanAssetChange,
  TransactionScanError,
  TransactionScanResult,
  TransactionScanValidation,
  TransactionScanValidationType,
} from './api';
import type { SecurityAlertsApiClient } from './SecurityAlertsApiClient';
import type { KnownCaip2ChainId } from '../../api';
import { xlmIcon } from '../../ui/images';
import type { ILogger } from '../../utils';
import {
  createPrefixedLogger,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  trackErrorIfNeeded,
} from '../../utils';
import { toDisplayBalance } from '../../utils/currency';
import { getIconUrl } from '../asset-metadata/utils';
import { TransactionExpireException } from '../transaction/exceptions';
import { Transaction } from '../transaction/Transaction';
import { assertTransactionTimeBound } from '../transaction/utils';

export class TransactionScanService {
  readonly #securityAlertsApiClient: SecurityAlertsApiClient;

  readonly #logger: ILogger;

  constructor({
    securityAlertsApiClient,
    logger,
  }: {
    securityAlertsApiClient: SecurityAlertsApiClient;
    logger: ILogger;
  }) {
    this.#securityAlertsApiClient = securityAlertsApiClient;
    this.#logger = createPrefixedLogger(logger, '[🛡️ TransactionScanService]');
  }

  async scanTransactionSafe({
    accountAddress,
    origin,
    scope,
    transaction,
    options,
  }: {
    accountAddress: string;
    origin: string;
    scope: KnownCaip2ChainId;
    transaction: string;
    options: TransactionScanOption[];
  }): Promise<TransactionScanResult | null> {
    try {
      const preflightValidationErrorResult = options.includes(
        TransactionScanOption.Simulation,
      )
        ? this.#preflightValidation(transaction, scope)
        : null;

      const result = await this.#securityAlertsApiClient.scanTransaction({
        accountAddress,
        origin,
        scope,
        transaction,
        options,
      });

      return this.#mapScan(
        result,
        preflightValidationErrorResult,
        options,
        scope,
        accountAddress,
      );
    } catch (error: unknown) {
      this.#logger.warn('Error scanning Stellar transaction', {
        reason: error,
      });

      await trackErrorIfNeeded(error);

      return null;
    }
  }

  /**
   * Local checks Blockaid does not perform before calling the Security Alerts API.
   *
   * Currently verifies the transaction time bound has not passed. When the XDR
   * cannot be parsed locally, returns `null` so Blockaid remains the source of
   * truth for malformed envelopes.
   *
   * @param xdr - The transaction XDR.
   * @param scope - The CAIP-2 chain of the transaction.
   * @returns A preflight validation error, or `null` when no local issue applies.
   */
  #preflightValidation(
    xdr: string,
    scope: KnownCaip2ChainId,
  ): TransactionScanError | null {
    try {
      const transaction = Transaction.fromXdr({
        xdr,
        scope,
      });

      assertTransactionTimeBound(transaction);

      return null;
    } catch (error) {
      if (error instanceof TransactionExpireException) {
        return {
          type: TransactionScanOption.Simulation,
          code: TransactionScanErrorId.TransactionExpired,
          message: 'Transaction expired',
        };
      }

      return null;
    }
  }

  /**
   * Maps a raw Security Alerts API response to the snap's scan result shape.
   *
   * @param result - Raw scan response from the Security Alerts API.
   * @param preflightValidationErrorResult - Local preflight error, if any.
   * @param options - Scan options that were requested.
   * @param scope - CAIP-2 chain of the transaction.
   * @param accountAddress - Signer address used to read per-account asset diffs.
   * @returns Normalized scan result for confirmation UI and handlers.
   */
  #mapScan(
    result: StellarTransactionScanResponse,
    preflightValidationErrorResult: TransactionScanError | null,
    options: TransactionScanOption[],
    scope: KnownCaip2ChainId,
    accountAddress: string,
  ): TransactionScanResult {
    const simulation = result.simulation ?? null;
    const validation = result.validation ?? null;
    const simulationError =
      simulation?.status === 'Error'
        ? this.#mapError(TransactionScanOption.Simulation, simulation.error)
        : null;

    const preflightValidationError = preflightValidationErrorResult ?? null;

    const validationError =
      validation?.status === 'Error'
        ? this.#mapError(TransactionScanOption.Validation, validation.error)
        : null;
    const missingResultError = this.#getMissingResultError({
      simulation,
      validation,
      options,
    });
    // Prefer the simulation revert: it carries the actionable reason (e.g.
    // "insufficient balance"). Preflight expiration is next — a local time-bound
    // failure the user can act on. A validation `Error` only means Blockaid
    // could not produce a verdict, so it must not mask simulation or preflight
    // failures.
    const error =
      simulationError ??
      preflightValidationError ??
      validationError ??
      missingResultError;

    return {
      status: error ? 'ERROR' : 'SUCCESS',
      estimatedChanges: {
        assets:
          simulation?.status === 'Success'
            ? this.#mapAssetChanges(
                this.#getSignerAssetDiffs(simulation, accountAddress),
                scope,
              )
            : [],
      },
      validation:
        validation?.status === 'Success'
          ? this.#mapValidation(validation)
          : null,
      error,
    };
  }

  /**
   * Returns the signer's asset diffs from a successful simulation.
   *
   * Blockaid reports per-account diffs under `assets_diffs`, keyed by address.
   * The aggregated `account_summary.account_assets_diffs` is frequently empty
   * (e.g. for tiny/zero-USD amounts), so we read the signer's own entry.
   *
   * @param simulation - The successful Blockaid simulation result.
   * @param accountAddress - The signer (scanned) account address.
   * @returns The signer's asset diffs.
   */
  #getSignerAssetDiffs(
    simulation: Extract<
      NonNullable<StellarTransactionScanResponse['simulation']>,
      { status: 'Success' }
    >,
    accountAddress: string,
  ): StellarAssetDiff[] {
    return simulation.assets_diffs?.[accountAddress] ?? [];
  }

  #mapAssetChanges(
    assetDiffs: StellarAssetDiff[],
    scope: KnownCaip2ChainId,
  ): TransactionScanAssetChange[] {
    return assetDiffs
      .flatMap((assetDiff) => {
        const changes: (TransactionScanAssetChange | null)[] = [];

        if (assetDiff.out) {
          changes.push(
            this.#mapAssetChange(assetDiff, AssetChangeDirection.Out, scope),
          );
        }
        if (assetDiff.in) {
          changes.push(
            this.#mapAssetChange(assetDiff, AssetChangeDirection.In, scope),
          );
        }

        return changes;
      })
      .filter(
        (change): change is TransactionScanAssetChange => change !== null,
      );
  }

  /**
   * Maps a single asset diff to our internal asset change format.
   *
   * Returns `null` for asset types the confirmation UI cannot render yet (for
   * example pool shares or other Blockaid classifications outside native,
   * classic, and SEP-41).
   *
   * @param assetDiff - The asset diff to map.
   * @param type - The direction of the asset change.
   * @param scope - The CAIP-2 chain of the transaction.
   * @returns The mapped asset change, or `null` when unsupported.
   */
  #mapAssetChange(
    assetDiff: StellarAssetDiff,
    type: AssetChangeDirection,
    scope: KnownCaip2ChainId,
  ): TransactionScanAssetChange | null {
    const { asset } = assetDiff;
    const transfer = assetDiff[type];
    const hasTransfer = transfer !== undefined && transfer !== null;
    const hasRawValue =
      hasTransfer &&
      transfer.raw_value !== undefined &&
      transfer.raw_value !== null;
    const usdPrice =
      hasTransfer && transfer.usd_price !== undefined
        ? transfer.usd_price
        : null;

    if (StellarNativeAssetDetailsStruct.is(asset)) {
      return {
        type,
        symbol: asset.code,
        name: asset.code,
        logo: xlmIcon,
        value: hasRawValue
          ? toDisplayBalance(new BigNumber(transfer.raw_value))
          : null,
        price: usdPrice,
      };
    }
    if (StellarClassicAssetDetailsStruct.is(asset)) {
      return {
        type,
        symbol: asset.code,
        name: asset.code,
        logo: getIconUrl(
          toCaip19ClassicAssetId(scope, asset.code, asset.issuer),
        ),
        value: hasRawValue
          ? toDisplayBalance(new BigNumber(transfer.raw_value))
          : null,
        price: usdPrice,
      };
    }
    if (StellarSep41AssetDetailsStruct.is(asset)) {
      return {
        type,
        symbol: asset.symbol,
        name: asset.name,
        logo: getIconUrl(toCaip19Sep41AssetId(scope, asset.address)),
        value: hasRawValue
          ? toDisplayBalance(new BigNumber(transfer.raw_value), asset.decimals)
          : null,
        price: usdPrice,
      };
    }

    // If the asset is unknown, return null.
    // We don't support unknown assets yet.
    return null;
  }

  #mapValidation(
    validation: Extract<
      NonNullable<StellarTransactionScanResponse['validation']>,
      { status: 'Success' }
    >,
  ): TransactionScanValidation {
    return {
      type: validation.result_type as TransactionScanValidationType,
      reason: validation.reason ?? null,
      description: validation.description ?? null,
    };
  }

  #mapError(type: string, message: string): TransactionScanError {
    return {
      type,
      code: this.#mapErrorCode(message),
      message,
    };
  }

  /**
   * Maps a Blockaid error message to a stable error code for localization.
   *
   * Blockaid may return either free-text revert messages (e.g. "insufficient
   * balance") or machine-readable codes (e.g. `insufficient_balance`). Known
   * free-text patterns are matched first; otherwise {@link #getErrorCode} is
   * used to pass through compact API codes unchanged.
   *
   * @param message - Raw error string from the simulation or validation payload.
   * @returns A normalized code aligned with {@link TransactionScanErrorId}.
   */
  #mapErrorCode(message: string): string {
    // Blockaid error message contains some keywords about the error.
    // Map them to a known error id.
    // - "insufficient balance" to "insufficientbalance".
    // - "no trustline" to "notrustline".
    if (message.toLowerCase().includes('insufficient balance')) {
      return TransactionScanErrorId.InsufficientBalance;
    }
    if (message.toLowerCase().includes('no trustline')) {
      return TransactionScanErrorId.NoTrustline;
    }
    return (
      this.#getErrorCode(message) ?? TransactionScanErrorId.InvalidTransaction
    );
  }

  #getMissingResultError({
    simulation,
    validation,
    options,
  }: {
    simulation: StellarTransactionScanResponse['simulation'] | null;
    validation: StellarTransactionScanResponse['validation'] | null;
    options: TransactionScanOption[];
  }): TransactionScanError | null {
    const requestedSimulation = options.includes(
      TransactionScanOption.Simulation,
    );
    const requestedValidation = options.includes(
      TransactionScanOption.Validation,
    );

    const allRequestedResultsMissing =
      (requestedSimulation || requestedValidation) &&
      (!requestedSimulation || simulation === null) &&
      (!requestedValidation || validation === null);

    if (!allRequestedResultsMissing) {
      return null;
    }

    return {
      type: 'response',
      code: 'empty',
      message: 'No scan results returned',
    };
  }

  #getErrorCode(message: string): string | null {
    if (/^[a-zA-Z0-9_:-]{1,80}$/u.test(message)) {
      return message;
    }

    return null;
  }
}
