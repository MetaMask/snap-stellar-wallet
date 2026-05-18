import {
  TransactionScanOption,
  type StellarAssetDiff,
  type StellarTransactionScanResponse,
  type TransactionScanAssetChange,
  type TransactionScanError,
  type TransactionScanResult,
  type TransactionScanValidation,
} from './api';
import type { SecurityAlertsApiClient } from './SecurityAlertsApiClient';
import type { KnownCaip2ChainId } from '../../api';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';

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

  async scanTransaction({
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
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Error scanning Stellar transaction',
        error,
      );
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
        changes.push(this.#mapAssetChange(assetDiff, 'out'));
      }
      if (assetDiff.in) {
        changes.push(this.#mapAssetChange(assetDiff, 'in'));
      }
      return changes;
    });
  }

  #mapAssetChange(
    assetDiff: StellarAssetDiff,
    type: 'in' | 'out',
  ): TransactionScanAssetChange {
    const transfer = assetDiff[type];
    const symbol =
      assetDiff.asset.symbol ?? assetDiff.asset.code ?? assetDiff.asset_type;

    return {
      type,
      symbol,
      name: assetDiff.asset.name ?? symbol,
      logo: null,
      value: transfer?.value ?? null,
      price: transfer?.usd_price ?? null,
    };
  }

  #mapValidation(
    validation: Extract<
      NonNullable<StellarTransactionScanResponse['validation']>,
      { status: 'Success' }
    >,
  ): TransactionScanValidation {
    return {
      type: validation.result_type,
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
