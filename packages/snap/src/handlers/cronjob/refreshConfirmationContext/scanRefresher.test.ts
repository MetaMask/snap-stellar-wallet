import { createConfirmationDataContext } from './__fixtures__/context.fixtures';
import { ConfirmationContextRefresherKey } from './api';
import { ConfirmationScanRefresher } from './scanRefresher';
import { KnownCaip2ChainId } from '../../../api';
import type { TransactionScanService } from '../../../services/transaction-scan';
import {
  AssetChangeDirection,
  TransactionScanOption,
  TransactionScanValidationType,
} from '../../../services/transaction-scan';
import {
  ConfirmationInterfaceKey,
  FetchStatus,
} from '../../../ui/confirmation/api';
import { logger } from '../../../utils/logger';

describe('ConfirmationScanRefresher', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const securityScanRequest = {
    accountAddress: 'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE',
    origin: 'https://example.com',
    scope,
    transaction: 'AAAAAgAAAAA=',
  };
  const scanResult = {
    status: 'SUCCESS' as const,
    estimatedChanges: {
      assets: [
        {
          type: AssetChangeDirection.Out,
          value: 2,
          price: null,
          symbol: 'USDC',
          name: 'USD Coin',
          logo: null,
        },
      ],
    },
    validation: {
      type: TransactionScanValidationType.Benign,
      reason: null,
      description: null,
    },
    error: null,
  };

  function setup() {
    const transactionScanService: jest.Mocked<
      Pick<TransactionScanService, 'scanTransactionSafe'>
    > = {
      scanTransactionSafe: jest.fn().mockResolvedValue(scanResult),
    };
    const refresher = new ConfirmationScanRefresher({
      logger,
      transactionScanService:
        transactionScanService as unknown as TransactionScanService,
    });

    return { refresher, transactionScanService };
  }

  function createScanContext(
    overrides: Parameters<typeof createConfirmationDataContext>[0] = {},
  ) {
    return createConfirmationDataContext({
      interfaceKey: ConfirmationInterfaceKey.SignTransaction,
      preferences: {
        useSecurityAlerts: true,
        simulateOnChainActions: true,
      },
      securityScanRequest,
      // Sign-transaction-like defaults: remote validation + remote simulation.
      securityScanning: true,
      remoteSimulation: true,
      scan: null,
      scanFetchStatus: FetchStatus.Fetching,
      ...overrides,
    });
  }

  it('requests simulation and validation when both intents and both scan preferences are enabled', async () => {
    const { refresher, transactionScanService } = setup();

    const result = await refresher.refresh(createScanContext());

    expect(transactionScanService.scanTransactionSafe).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });
    expect(result).toStrictEqual({
      result: {
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('requests simulation when remote simulation is enabled and on-chain simulation is allowed', async () => {
    const { refresher, transactionScanService } = setup();

    await refresher.refresh(
      createScanContext({
        remoteSimulation: true,
        securityScanning: true,
        preferences: {
          useSecurityAlerts: false,
          simulateOnChainActions: true,
        },
      }),
    );

    expect(transactionScanService.scanTransactionSafe).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [TransactionScanOption.Simulation],
    });
  });

  it('requests only validation when remote simulation is disabled (local-simulation flow)', async () => {
    const { refresher, transactionScanService } = setup();

    await refresher.refresh(createScanContext({ remoteSimulation: false }));

    expect(transactionScanService.scanTransactionSafe).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [TransactionScanOption.Validation],
    });
  });

  it('uses Blockaid estimated changes when remote simulation returns asset rows', async () => {
    const { refresher } = setup();
    const localEstimatedChanges = {
      assets: [
        {
          type: AssetChangeDirection.Out,
          value: 1,
          price: null,
          symbol: 'XLM',
          name: 'Stellar Lumens',
          logo: null,
        },
      ],
    };

    const result = await refresher.refresh(
      createScanContext({
        scan: {
          status: 'SUCCESS',
          estimatedChanges: localEstimatedChanges,
          validation: null,
          error: null,
        },
      }),
    );

    expect(result).toStrictEqual({
      result: {
        scan: scanResult,
        scanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('falls back to locally-derived estimated changes when Blockaid returns no asset rows', async () => {
    const { refresher, transactionScanService } = setup();
    const localEstimatedChanges = {
      assets: [
        {
          type: AssetChangeDirection.Out,
          value: 12.5,
          price: null,
          symbol: 'XLM',
          name: 'Stellar Lumens',
          logo: null,
        },
      ],
    };
    const emptyRemoteScan = {
      ...scanResult,
      estimatedChanges: { assets: [] },
    };
    transactionScanService.scanTransactionSafe.mockResolvedValueOnce(
      emptyRemoteScan,
    );

    const result = await refresher.refresh(
      createScanContext({
        scan: {
          status: 'SUCCESS',
          estimatedChanges: localEstimatedChanges,
          validation: null,
          error: null,
        },
      }),
    );

    expect(result).toStrictEqual({
      result: {
        scan: {
          ...emptyRemoteScan,
          estimatedChanges: localEstimatedChanges,
        },
        scanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('keeps the locally-seeded estimated changes for local-simulation flows even when the scan returns rows', async () => {
    const { refresher } = setup();
    const localEstimatedChanges = {
      assets: [
        {
          type: AssetChangeDirection.Out,
          value: 7,
          price: null,
          symbol: 'XLM',
          name: 'Stellar Lumens',
          logo: null,
        },
      ],
    };

    // Send / change-trust never opt into remote simulation; a validation-only
    // scan can still carry simulation diffs, which must not override the seed.
    const result = await refresher.refresh(
      createScanContext({
        remoteSimulation: false,
        scan: {
          status: 'SUCCESS',
          estimatedChanges: localEstimatedChanges,
          validation: null,
          error: null,
        },
      }),
    );

    expect(result).toStrictEqual({
      result: {
        scan: { ...scanResult, estimatedChanges: localEstimatedChanges },
        scanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('returns error status preserving estimated changes when scan returns null', async () => {
    const { refresher, transactionScanService } = setup();
    transactionScanService.scanTransactionSafe.mockResolvedValueOnce(null);
    const localEstimatedChanges = {
      assets: [
        {
          type: AssetChangeDirection.Out,
          value: 1,
          price: null,
          symbol: 'XLM',
          name: 'Stellar Lumens',
          logo: null,
        },
      ],
    };

    const result = await refresher.refresh(
      createScanContext({
        preferences: {
          useSecurityAlerts: true,
          simulateOnChainActions: false,
        },
        scan: {
          status: 'SUCCESS',
          estimatedChanges: localEstimatedChanges,
          validation: null,
          error: null,
        },
      }),
    );

    expect(result).toStrictEqual({
      result: {
        scan: {
          status: 'ERROR',
          estimatedChanges: localEstimatedChanges,
          validation: null,
          error: null,
        },
        scanFetchStatus: FetchStatus.Error,
      },
      reschedule: false,
    });
  });

  it('fetches when only simulateOnChainActions is enabled and remote simulation is requested', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createScanContext({
          remoteSimulation: true,
          preferences: {
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not fetch when simulateOnChainActions is enabled but remote simulation is not requested', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createScanContext({
          remoteSimulation: false,
          preferences: {
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
        }),
      ),
    ).toBe(false);
  });

  it('does not fetch when securityScanRequest is missing', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createScanContext({
          securityScanRequest: undefined,
        }),
      ),
    ).toBe(false);
  });

  it('writes recovery error when scan prefs are enabled but request is missing', () => {
    const { refresher } = setup();

    expect(
      refresher.recoveryResult(
        createScanContext({
          securityScanRequest: undefined,
        }),
      ),
    ).toStrictEqual({
      result: {
        scan: null,
        scanFetchStatus: FetchStatus.Error,
      },
      reschedule: false,
    });
  });

  it('uses the scan refresher key', () => {
    const { refresher } = setup();
    expect(refresher.key).toBe(ConfirmationContextRefresherKey.Scan);
  });
});
