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
    estimatedChanges: { assets: [] },
    validation: {
      type: TransactionScanValidationType.Benign,
      reason: null,
      description: null,
    },
    error: null,
  };

  function setup() {
    const transactionScanService: jest.Mocked<
      Pick<TransactionScanService, 'scanTransaction'>
    > = {
      scanTransaction: jest.fn().mockResolvedValue(scanResult),
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

  it('requests validation only and never remote simulation', async () => {
    const { refresher, transactionScanService } = setup();

    const result = await refresher.refresh(createScanContext());

    // Remote simulation is intentionally omitted; estimated changes come from
    // the local on-chain simulation instead.
    expect(transactionScanService.scanTransaction).toHaveBeenCalledWith({
      ...securityScanRequest,
      options: [TransactionScanOption.Validation],
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
    ConfirmationInterfaceKey.ChangeTrustlineOptIn,
    ConfirmationInterfaceKey.ChangeTrustlineOptOut,
  ])(
    'never requests remote simulation for %s even when simulateOnChainActions is enabled',
    async (interfaceKey) => {
      const { refresher, transactionScanService } = setup();

      await refresher.refresh(createScanContext({ interfaceKey }));

      expect(transactionScanService.scanTransaction).toHaveBeenCalledWith({
        ...securityScanRequest,
        options: [TransactionScanOption.Validation],
      });
    },
  );

  it('preserves locally-derived estimated changes over the Blockaid result', async () => {
    const { refresher } = setup();
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
          ...scanResult,
          estimatedChanges: localEstimatedChanges,
        },
        scanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('returns error status preserving estimated changes when scan returns null', async () => {
    const { refresher, transactionScanService } = setup();
    transactionScanService.scanTransaction.mockResolvedValueOnce(null);
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

  it('does not fetch when only simulateOnChainActions is enabled', () => {
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
