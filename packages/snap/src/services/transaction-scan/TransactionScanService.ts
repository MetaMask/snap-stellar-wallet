import { BigNumber } from 'bignumber.js';

import { AssetChangeDirection, TransactionScanOption } from './api';
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
import { STELLAR_DECIMAL_PLACES } from '../../constants';
import type { ILogger } from '../../utils';
import { createPrefixedLogger, trackError } from '../../utils';
import { normalizeAmount } from '../../utils/currency';

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
      const result = await this.#securityAlertsApiClient.scanTransaction({
        accountAddress,
        origin,
        scope,
        transaction,
        options,
      });

      return this.#mapScan(result, options);
    } catch (error: unknown) {
      this.#logger.warn('Error scanning Stellar transaction', {
        reason: error,
      });

      await trackError(error);

      return null;
    }
  }

  #mapScan(
    result: StellarTransactionScanResponse,
    options: TransactionScanOption[],
  ): TransactionScanResult {
    const simulation = result.simulation ?? null;
    const validation = result.validation ?? null;
    const simulationError =
      simulation?.status === 'Error'
        ? this.#mapError('simulation', simulation.error)
        : null;
    const validationError =
      validation?.status === 'Error'
        ? this.#mapError('validation', validation.error)
        : null;
    const missingResultError = this.#getMissingResultError({
      simulation,
      validation,
      options,
    });
    const error = validationError ?? simulationError ?? missingResultError;

    return {
      status: error ? 'ERROR' : 'SUCCESS',
      estimatedChanges: {
        assets:
          simulation?.status === 'Success'
            ? this.#mapAssetChanges(
                simulation.account_summary.account_assets_diffs ?? [],
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

  #mapAssetChanges(
    assetDiffs: StellarAssetDiff[],
  ): TransactionScanAssetChange[] {
    return assetDiffs.flatMap((assetDiff) => {
      const changes: TransactionScanAssetChange[] = [];
      if (assetDiff.out) {
        changes.push(this.#mapAssetChange(assetDiff, AssetChangeDirection.Out));
      }
      if (assetDiff.in) {
        changes.push(this.#mapAssetChange(assetDiff, AssetChangeDirection.In));
      }
      return changes;
    });
  }

  #mapAssetChange(
    assetDiff: StellarAssetDiff,
    type: AssetChangeDirection,
  ): TransactionScanAssetChange {
    const transfer = assetDiff[type];
    const symbol =
      assetDiff.asset.symbol ?? assetDiff.asset.code ?? assetDiff.asset_type;

    return {
      type,
      symbol,
      name: assetDiff.asset.name ?? symbol,
      logo: null,
      value: this.#computeDisplayValue(transfer, assetDiff),
      price: transfer?.usd_price ?? null,
    };
  }

  /**
   * Computes the human-readable amount for an asset transfer.
   * Prefers {@link StellarAssetTransferDetails.raw_value} with known decimals
   * (Tron parity) because Blockaid's `value` can be imprecise for fractional
   * native XLM amounts.
   *
   * @param transfer - The in/out transfer details from Blockaid.
   * @param assetDiff - The parent asset diff (used to resolve decimals).
   * @returns The display amount, or null when unavailable.
   */
  #computeDisplayValue(
    transfer: StellarAssetDiff['in'] | StellarAssetDiff['out'],
    assetDiff: StellarAssetDiff,
  ): number | null {
    if (transfer === undefined || transfer === null) {
      return null;
    }

    const decimals = this.#resolveAssetDecimals(assetDiff);
    if (decimals !== undefined && transfer.raw_value !== undefined) {
      return normalizeAmount(
        new BigNumber(transfer.raw_value),
        decimals,
      ).toNumber();
    }

    return transfer.value ?? null;
  }

  /**
   * Resolves asset decimals for Blockaid simulation diffs.
   *
   * Native and classic Stellar assets use 7 decimal places; contract tokens do
   * not expose decimals in the Blockaid payload today. We key off the canonical
   * top-level `asset_type` (`NATIVE` / `ASSET`) — the nested `asset.type` is the
   * same classification and adds no information.
   *
   * @param assetDiff - The asset diff from Blockaid.
   * @returns The decimals when known.
   */
  #resolveAssetDecimals(assetDiff: StellarAssetDiff): number | undefined {
    const { asset_type: assetType } = assetDiff;

    if (assetType === 'NATIVE' || assetType === 'ASSET') {
      return STELLAR_DECIMAL_PLACES;
    }

    return undefined;
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
      code: this.#getErrorCode(message),
      message,
    };
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
