import type { Json } from '@metamask/utils';

import {
  BackgroundEventMethod,
  RefreshConfirmationSecurityScanJsonRpcRequestStruct,
} from './api';
import type {
  RefreshConfirmationSecurityScanJsonRpcRequest,
  RefreshConfirmationSecurityScanParams,
} from './api';
import { CronjobBaseHandler } from './base';
import type { TransactionScanService } from '../../services/transaction-scan';
import { TransactionScanOption } from '../../services/transaction-scan';
import type {
  ConfirmationInterfaceKey,
  ContextWithSecurityScan,
} from '../../ui/confirmation/api';
import {
  ContextWithSecurityScanStruct,
  FetchStatus,
} from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  Duration,
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../utils/snap';

type SecurityScanPreferences = {
  useSecurityAlerts?: boolean;
  simulateOnChainActions?: boolean;
};

type SecurityScanInterfaceContext = Record<string, Json> &
  ContextWithSecurityScan;

export class RefreshConfirmationSecurityScanHandler extends CronjobBaseHandler<RefreshConfirmationSecurityScanJsonRpcRequest> {
  readonly #transactionScanService: TransactionScanService;

  readonly #confirmationUIController: ConfirmationUXController;

  static async scheduleBackgroundEvent(
    params: RefreshConfirmationSecurityScanParams,
    duration: Duration = Duration.TwentySeconds,
  ): Promise<void> {
    await scheduleBackgroundEvent({
      method: BackgroundEventMethod.RefreshConfirmationSecurityScan,
      params,
      duration,
    });
  }

  constructor({
    logger,
    transactionScanService,
    confirmationUIController,
  }: {
    logger: ILogger;
    transactionScanService: TransactionScanService;
    confirmationUIController: ConfirmationUXController;
  }) {
    const prefixedLogger = createPrefixedLogger(
      logger,
      '[🔄 RefreshConfirmationSecurityScanHandler]',
    );
    super({
      logger: prefixedLogger,
      requestStruct: RefreshConfirmationSecurityScanJsonRpcRequestStruct,
    });
    this.#transactionScanService = transactionScanService;
    this.#confirmationUIController = confirmationUIController;
  }

  protected async handleCronJobRequest(
    request: RefreshConfirmationSecurityScanJsonRpcRequest,
  ): Promise<void> {
    this.logger.info('Refreshing confirmation security scan...');
    const { interfaceId, scope, interfaceKey } = request.params;

    const interfaceContext = await this.#getInterfaceContextIfExists({
      interfaceId,
      interfaceKey,
    });
    if (interfaceContext === null) {
      return;
    }

    const scanRequest = interfaceContext.securityScanRequest;
    if (!scanRequest) {
      this.logger.warn(
        'Interface context is missing security scan request, skipping refresh',
      );
      const options = this.#getScanOptions(interfaceContext.preferences);
      await this.#reRenderSecurityScan({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...interfaceContext,
          scan: null,
          scanFetchStatus:
            options.length > 0 ? FetchStatus.Error : FetchStatus.Fetched,
        },
      });
      return;
    }

    const options = this.#getScanOptions(interfaceContext.preferences);
    if (options.length === 0) {
      await this.#reRenderSecurityScan({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...interfaceContext,
          scan: null,
          scanFetchStatus: FetchStatus.Fetched,
        },
      });
      return;
    }

    try {
      await this.#reRenderSecurityScan({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...interfaceContext,
          scanFetchStatus: FetchStatus.Fetching,
        },
      });

      const scan = await this.#transactionScanService.scanTransaction({
        ...scanRequest,
        options,
      });

      const latestContext = await this.#getInterfaceContextIfExists({
        interfaceId,
        interfaceKey,
      });
      if (latestContext === null) {
        return;
      }

      const updatedContext: SecurityScanInterfaceContext = {
        ...latestContext,
        scan,
        scanFetchStatus: scan ? FetchStatus.Fetched : FetchStatus.Error,
      };

      await this.#reRenderSecurityScan({
        interfaceId,
        interfaceKey,
        updatedContext,
      });

      if (scan) {
        await RefreshConfirmationSecurityScanHandler.scheduleBackgroundEvent({
          scope,
          interfaceId,
          interfaceKey,
        });
      }
    } catch (error) {
      this.logger.error('Error refreshing confirmation security scan:', error);

      const currentContext = await this.#getInterfaceContextIfExists({
        interfaceId,
        interfaceKey,
      });
      if (currentContext !== null) {
        await this.#reRenderSecurityScan({
          interfaceId,
          interfaceKey,
          updatedContext: {
            ...currentContext,
            scan: null,
            scanFetchStatus: FetchStatus.Error,
          },
        });
      }
    }
  }

  async #reRenderSecurityScan(params: {
    interfaceId: string;
    updatedContext: Record<string, Json>;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<void> {
    const { interfaceId, interfaceKey, updatedContext } = params;

    await this.#confirmationUIController.updateConfirmation({
      interfaceId,
      updatedContext,
      interfaceKey,
    });
  }

  #getScanOptions(
    preferences: SecurityScanPreferences | undefined,
  ): TransactionScanOption[] {
    const options: TransactionScanOption[] = [];

    if (preferences?.simulateOnChainActions) {
      options.push(TransactionScanOption.Simulation);
    }

    if (preferences?.useSecurityAlerts) {
      options.push(TransactionScanOption.Validation);
    }

    return options;
  }

  async #getInterfaceContextIfExists(params: {
    interfaceId: string;
    interfaceKey: ConfirmationInterfaceKey;
  }): Promise<SecurityScanInterfaceContext | null> {
    const { interfaceId, interfaceKey } = params;
    const interfaceContext =
      await getInterfaceContextIfExists<Json>(interfaceId);

    if (!interfaceContext) {
      this.logger.info('Interface no longer exists, cleaning up');
      return null;
    }

    if (!isRecord(interfaceContext)) {
      this.logger.warn(
        'Interface context is not an object, skipping security scan refresh',
      );
      return null;
    }

    if (!ContextWithSecurityScanStruct.is(interfaceContext)) {
      this.logger.warn(
        'Interface context does not match the ContextWithSecurityScan interface, marking scan as failed',
      );
      await this.#reRenderSecurityScan({
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...interfaceContext,
          scan: null,
          scanFetchStatus: FetchStatus.Error,
        },
      });
      return null;
    }

    return interfaceContext as SecurityScanInterfaceContext;
  }
}

/**
 * Checks whether a JSON value is an object record.
 *
 * @param value - The JSON value to check.
 * @returns True when the value is a non-array object.
 */
function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
