import { createConfirmationDataContext } from './__fixtures__/context.fixtures';
import { ConfirmationContextRefresherKey } from './api';
import { ConfirmationScanRefresher } from './scanRefresher';
import { KnownCaip2ChainId } from '../../../api';
import type { TransactionScanService } from '../../../services/transaction-scan';
import {
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
          type: 'out' as const,
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
      scan: null,
      scanFetchStatus: FetchStatus.Fetching,
      ...overrides,
    });
  }

  it('requests simulation and validation for sign transaction when both scan preferences are enabled', async () => {
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

  it.each([
    ConfirmationInterfaceKey.SignTransaction,
    ConfirmationInterfaceKey.ConfirmSendTransaction,
  ])(
    'requests simulation for %s when estimated changes are enabled',
    async (interfaceKey) => {
      const { refresher, transactionScanService } = setup();

      await refresher.refresh(
        createScanContext({
          interfaceKey,
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
    },
  );

  it.each([
    ConfirmationInterfaceKey.ChangeTrustlineOptIn,
    ConfirmationInterfaceKey.ChangeTrustlineOptOut,
  ])('does not request simulation for %s', async (interfaceKey) => {
    const { refresher, transactionScanService } = setup();

    await refresher.refresh(createScanContext({ interfaceKey }));

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
          type: 'out' as const,
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
          type: 'out' as const,
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

  it('returns error status preserving estimated changes when scan returns null', async () => {
    const { refresher, transactionScanService } = setup();
    transactionScanService.scanTransactionSafe.mockResolvedValueOnce(null);
    const localEstimatedChanges = {
      assets: [
        {
          type: 'out' as const,
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

  it('fetches when only simulateOnChainActions is enabled for sign transaction', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createScanContext({
          preferences: {
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not fetch when only simulateOnChainActions is enabled for change trust', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createScanContext({
          interfaceKey: ConfirmationInterfaceKey.ChangeTrustlineOptIn,
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
