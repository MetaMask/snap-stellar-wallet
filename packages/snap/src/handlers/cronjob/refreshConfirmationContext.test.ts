import { BigNumber } from 'bignumber.js';

import { BackgroundEventMethod } from './api';
import { RefreshConfirmationContextHandler } from './refreshConfirmationContext';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api';
import { KnownCaip2ChainId } from '../../api';
import type { PriceService } from '../../services/price';
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

describe('RefreshConfirmationContextHandler', () => {
  const interfaceId = 'interface-id';
  const scope = KnownCaip2ChainId.Mainnet;
  const interfaceKey = ConfirmationInterfaceKey.SignTransaction;
  const xlmAssetId =
    'stellar:pubnet/slip44:148' as KnownCaip19AssetIdOrSlip44Id;

  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: BackgroundEventMethod.RefreshConfirmationContext,
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

  /** Context shape every confirmation dialog uses when both sources are enabled. */
  const baseContext = {
    currency: 'usd',
    tokenPrices: { [xlmAssetId]: null },
    tokenPricesFetchStatus: FetchStatus.Fetching,
    preferences: {
      useExternalPricingData: true,
      useSecurityAlerts: true,
      simulateOnChainActions: true,
    },
    securityScanRequest,
    scan: null,
    scanFetchStatus: FetchStatus.Fetching,
  };

  const scanResult = {
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
    const priceService: jest.Mocked<Pick<PriceService, 'getSpotPrices'>> = {
      getSpotPrices: jest.fn().mockResolvedValue({
        [xlmAssetId]: { id: xlmAssetId, price: new BigNumber(0.13) },
      }),
    };
    const transactionScanService: jest.Mocked<
      Pick<TransactionScanService, 'scanTransaction'>
    > = {
      scanTransaction: jest.fn().mockResolvedValue(scanResult),
    };
    const confirmationUIController: jest.Mocked<
      Pick<ConfirmationUXController, 'updateConfirmation'>
    > = {
      updateConfirmation: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new RefreshConfirmationContextHandler({
      logger,
      priceService: priceService as unknown as PriceService,
      transactionScanService:
        transactionScanService as unknown as TransactionScanService,
      confirmationUIController:
        confirmationUIController as unknown as ConfirmationUXController,
    });

    return {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    };
  }

  it('refreshes both prices and scan in parallel and reschedules', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(priceService.getSpotPrices).toHaveBeenCalledWith({
      assetIds: [xlmAssetId],
      vsCurrency: 'usd',
    });
    expect(transactionScanService.scanTransaction).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });

    // Single write at the end with both fields updated.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        tokenPrices: { [xlmAssetId]: '0.13' },
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });

    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: { scope, interfaceId, interfaceKey },
      duration: Duration.TwentySeconds,
    });
  });

  it('skips the pre-update write when both statuses are already Fetching (first run)', async () => {
    const { handler, confirmationUIController } = setup();
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    // Only one updateConfirmation call (the final write); no redundant
    // pre-fetch write because both statuses are already Fetching.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledTimes(
      1,
    );
  });

  it('writes a pre-fetch Fetching update on subsequent cycles', async () => {
    const { handler, confirmationUIController } = setup();
    const previousCycleContext = {
      ...baseContext,
      tokenPrices: { [xlmAssetId]: '0.10' },
      tokenPricesFetchStatus: FetchStatus.Fetched,
      scan: scanResult,
      scanFetchStatus: FetchStatus.Fetched,
    };
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValue(previousCycleContext);

    await handler.handle(request);

    // First call: flip both statuses back to Fetching.
    expect(confirmationUIController.updateConfirmation).toHaveBeenNthCalledWith(
      1,
      {
        interfaceId,
        interfaceKey,
        updatedContext: {
          ...previousCycleContext,
          tokenPricesFetchStatus: FetchStatus.Fetching,
          scanFetchStatus: FetchStatus.Fetching,
        },
      },
    );
    // Second call: final write with results.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledTimes(
      2,
    );
  });

  it('reschedules when prices succeed even if scan returns null', async () => {
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
        tokenPrices: { [xlmAssetId]: '0.13' },
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('reschedules when scan succeeds even if prices throw', async () => {
    const { handler, priceService, confirmationUIController } = setup();
    priceService.getSpotPrices.mockRejectedValue(new Error('price api down'));
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        tokenPricesFetchStatus: FetchStatus.Error,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('does not reschedule when both sources fail this cycle', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    priceService.getSpotPrices.mockRejectedValue(new Error('price api down'));
    transactionScanService.scanTransaction.mockResolvedValue(null);
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        tokenPricesFetchStatus: FetchStatus.Error,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('fetches prices and writes scan Error when securityScanRequest is missing but scan prefs are enabled', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const { securityScanRequest: _omit, ...context } = baseContext;
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).toHaveBeenCalledTimes(1);
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();

    // Scan must resolve to terminal Error so the dialog does not stay stuck
    // in "scan in progress" — restoring the previous single-handler behavior.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        tokenPrices: { [xlmAssetId]: '0.13' },
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('fetches the scan and resolves the price status when tokenPrices is empty', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const context = {
      ...baseContext,
      tokenPrices: {},
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).toHaveBeenCalledTimes(1);

    // Price status resolves to Fetched (nothing to fetch) so the dialog
    // does not stay stuck on the price loading indicator.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('does not fetch prices when external pricing is disabled', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const context = {
      ...baseContext,
      preferences: {
        ...baseContext.preferences,
        useExternalPricingData: false,
      },
      tokenPricesFetchStatus: FetchStatus.Fetched,
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).toHaveBeenCalledTimes(1);
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalled();
  });

  it('writes recovery patches for both sources when neither can be fetched but the UI is mid-flight', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const { securityScanRequest: _omit, ...rest } = baseContext;
    const context = {
      ...rest,
      tokenPrices: {},
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();

    // No fetch, but the UI must not hang: prices → Fetched, scan → Error
    // (options were enabled but the request is missing).
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    // No fetch ran successfully → no reschedule.
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('does nothing when both sources are already in a terminal status', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const { securityScanRequest: _omit, ...rest } = baseContext;
    const context = {
      ...rest,
      tokenPrices: {},
      tokenPricesFetchStatus: FetchStatus.Fetched,
      scanFetchStatus: FetchStatus.Fetched,
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('skips a source whose previous cycle ended in terminal Error', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const context = {
      ...baseContext,
      tokenPricesFetchStatus: FetchStatus.Error,
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).toHaveBeenCalledTimes(1);

    // Terminal Error stays as Error; no recovery patch applied.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
  });

  it('resolves scan status to Fetched when preferences disable both alerts and simulation', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const context = {
      ...baseContext,
      preferences: {
        useExternalPricingData: true,
        useSecurityAlerts: false,
        simulateOnChainActions: false,
      },
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(context);

    await handler.handle(request);

    expect(priceService.getSpotPrices).toHaveBeenCalledTimes(1);
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();

    // No scan to run, so scan resolves to terminal Fetched. UI doesn't hang.
    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...context,
        tokenPrices: { [xlmAssetId]: '0.13' },
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: null,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
  });

  it('does nothing when the interface is gone before any fetch', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(null);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(confirmationUIController.updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('does not write the final update when the interface is dismissed mid-fetch', async () => {
    const { handler, confirmationUIController } = setup();
    // First call returns baseContext (pre-fetch). Second call (after parallel
    // fetches resolve) returns null because the dialog was dismissed.
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce(null);

    await handler.handle(request);

    // No second updateConfirmation call after the dismissal.
    // (No pre-fetch write either because both statuses are already Fetching.)
    expect(confirmationUIController.updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('marks both sources as Error when the interface context is malformed', async () => {
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();
    const malformed = {
      ...baseContext,
      preferences: 'invalid',
    };
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(malformed);

    await handler.handle(request);

    expect(priceService.getSpotPrices).not.toHaveBeenCalled();
    expect(transactionScanService.scanTransaction).not.toHaveBeenCalled();

    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...malformed,
        tokenPricesFetchStatus: FetchStatus.Error,
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
    });
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('writes a coherent context regardless of fetch resolution order', async () => {
    // Race scenario: scan resolves first, prices resolve later. Single write
    // at the end must still carry both fields correctly.
    const {
      handler,
      priceService,
      transactionScanService,
      confirmationUIController,
    } = setup();

    // Mock the slow path: scan resolves quickly (microtask), prices resolves
    // later (macrotask). Both are awaited via Promise.allSettled in the
    // handler — the single write at the end must contain both results.
    transactionScanService.scanTransaction.mockImplementation(
      async () => scanResult,
    );
    priceService.getSpotPrices.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        [xlmAssetId]: { id: xlmAssetId, price: new BigNumber(0.42) },
      } as unknown as Awaited<ReturnType<PriceService['getSpotPrices']>>;
    });
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    await handler.handle(request);

    expect(confirmationUIController.updateConfirmation).toHaveBeenCalledWith({
      interfaceId,
      interfaceKey,
      updatedContext: {
        ...baseContext,
        tokenPrices: { [xlmAssetId]: '0.42' },
        tokenPricesFetchStatus: FetchStatus.Fetched,
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
    });
  });
});
