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
import {
  createPrefixedLogger,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
  trackError,
} from '../../utils';
import { normalizeAmount } from '../../utils/currency';
import { getIconUrl } from '../asset-metadata/utils';

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

      return this.#mapScan(result, options, scope, accountAddress);
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
    scope: KnownCaip2ChainId,
    accountAddress: string,
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
    // Prefer the simulation revert: it carries the actionable reason (e.g.
    // "insufficient balance"). A validation `Error` only means Blockaid could
    // not produce a verdict — never that the transaction is malicious (that
    // comes from a validation `Success` with a malicious/warning result_type) —
    // so it should not mask why the transaction would actually fail.
    const error = simulationError ?? validationError ?? missingResultError;

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
   * (e.g. for tiny/zero-USD amounts), so we read the signer's own entry first
   * and only fall back to the summary.
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
    return (
      simulation.assets_diffs?.[accountAddress] ??
      simulation.account_summary.account_assets_diffs ??
      []
    );
  }

  #mapAssetChanges(
    assetDiffs: StellarAssetDiff[],
    scope: KnownCaip2ChainId,
  ): TransactionScanAssetChange[] {
    return assetDiffs.flatMap((assetDiff) => {
      const changes: TransactionScanAssetChange[] = [];
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
    });
  }

  #mapAssetChange(
    assetDiff: StellarAssetDiff,
    type: AssetChangeDirection,
    scope: KnownCaip2ChainId,
  ): TransactionScanAssetChange {
    const transfer = assetDiff[type];
    const symbol =
      assetDiff.asset.symbol ?? assetDiff.asset.code ?? assetDiff.asset_type;

    return {
      type,
      symbol,
      name: assetDiff.asset.name ?? symbol,
      logo: this.#resolveLogo(assetDiff, scope),
      value: this.#computeDisplayValue(transfer, assetDiff),
      price: transfer?.usd_price ?? null,
    };
  }

  /**
   * Resolves the asset icon URL for a Blockaid diff. Blockaid does not return an
   * icon, so we derive it from the asset identity (the same static icon source
   * the rest of the app uses). Native XLM is left to the UI's bundled icon.
   *
   * @param assetDiff - The asset diff from Blockaid.
   * @param scope - The CAIP-2 chain of the transaction.
   * @returns The icon URL, or null when it cannot be derived.
   */
  #resolveLogo(
    assetDiff: StellarAssetDiff,
    scope: KnownCaip2ChainId,
  ): string | null {
    const { asset, asset_type: assetType } = assetDiff;

    if (assetType === 'NATIVE' || asset.type === 'NATIVE') {
      return null;
    }
    if (asset.code !== undefined && asset.issuer !== undefined) {
      return getIconUrl(
        toCaip19ClassicAssetId(scope, asset.code, asset.issuer),
      );
    }
    if (asset.address !== undefined) {
      return getIconUrl(toCaip19Sep41AssetId(scope, asset.address));
    }
    return null;
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
   * not expose decimals in the Blockaid payload today. Blockaid is inconsistent
   * about where it puts the classification, so we check both the top-level
   * `asset_type` and the nested `asset.type` (e.g. classic issued assets such as
   * USDC surface `ASSET` on one but not always the other).
   *
   * @param assetDiff - The asset diff from Blockaid.
   * @returns The decimals when known.
   */
  #resolveAssetDecimals(assetDiff: StellarAssetDiff): number | undefined {
    const { asset_type: assetType, asset } = assetDiff;

    if (
      assetType === 'NATIVE' ||
      asset.type === 'NATIVE' ||
      assetType === 'ASSET' ||
      asset.type === 'ASSET'
    ) {
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
