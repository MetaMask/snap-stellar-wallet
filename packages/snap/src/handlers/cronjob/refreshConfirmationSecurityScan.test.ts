import { BackgroundEventMethod } from './api';
import { RefreshConfirmationSecurityScanHandler } from './refreshConfirmationSecurityScan';
import { KnownCaip2ChainId } from '../../api';
import type { TransactionScanService } from '../../services/transaction-scan';
import { TransactionScanOption } from '../../services/transaction-scan';
import {
  ConfirmationInterfaceKey,
  FetchStatus,
} from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { Duration } from '../../utils';
import { logger } from '../../utils/logger';
import {
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../utils/snap';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap', () => {
  const actual = jest.requireActual('../../utils/snap');
  return {
    ...actual,
    getInterfaceContextIfExists: jest.fn(),
    scheduleBackgroundEvent: jest.fn().mockResolvedValue('scheduled'),
  };
});

describe('RefreshConfirmationSecurityScanHandler', () => {
  const interfaceId = 'interface-id';
  const scope = KnownCaip2ChainId.Mainnet;
  const interfaceKey = ConfirmationInterfaceKey.SignTransaction;
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: BackgroundEventMethod.RefreshConfirmationSecurityScan,
    params: {
      interfaceId,
      scope,
      interfaceKey,
    },
  };
  const securityScanRequest = {
    accountAddress: 'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE',
    origin: 'https://example.com',
    scope,
    transaction: 'AAAAAgAAAAA=',
  };
  const baseContext = {
    preferences: {
      useSecurityAlerts: true,
      simulateOnChainActions: true,
    },
    securityScanRequest,
    scan: null,
    scanFetchStatus: FetchStatus.Fetching,
  };
  const scan = {
    status: 'SUCCESS' as const,
    estimatedChanges: { assets: [] },
    validation: {
      type: 'Benign' as const,
      reason: null,
      description: null,
    },
    error: null,
  };

  beforeEach(() => {
    jest.mocked(getInterfaceContextIfExists).mockReset();
    jest.mocked(scheduleBackgroundEvent).mockClear();
    jest.mocked(scheduleBackgroundEvent).mockResolvedValue('scheduled');
  });

  function setup() {
    const transactionScanService: jest.Mocked<
      Pick<TransactionScanService, 'scanTransaction'>
    > = {
      scanTransaction: jest.fn().mockResolvedValue(scan),
    };
    const confirmationUIController: jest.Mocked<
      Pick<ConfirmationUXController, 'updateConfirmation'>
    > = {
      updateConfirmation: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new RefreshConfirmationSecurityScanHandler({
      logger,
      transactionScanService:
        transactionScanService as unknown as TransactionScanService,
      confirmationUIController:
        confirmationUIController as unknown as ConfirmationUXController,
    });

    return {
      handler,
      transactionScanService,
      confirmationUIController,
    };
  }

  it('refreshes the scan and schedules the next refresh', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(transactionScanService.scanTransaction).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        scanFetchStatus: FetchStatus.Fetching,
      },
    });
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        scan,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationSecurityScan,
      params: {
        scope,
        interfaceId,
        interfaceKey,
      },
      duration: Duration.TwentySeconds,
    });
  });

  it('does not scan when security preferences are disabled', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    const context = {
      ...baseContext,
      preferences: {
        useSecurityAlerts: false,
        simulateOnChainActions: false,
      },
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        scan: null,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the interface is gone', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(null);

    await handler.handle(request);

    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('marks the scan as error when the scan request is missing', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    const { securityScanRequest: _securityScanRequest, ...context } =
      baseContext;
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('marks the scan as error when the interface context is malformed', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    const context = {
      ...baseContext,
      preferences: 'invalid',
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('marks the scan as error when the service returns null', async () => {
    const { handler, transactionScanService, confirmationUIController } =
      setup();
    transactionScanService.scanTransaction.mockResolvedValue(null);
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });
});
