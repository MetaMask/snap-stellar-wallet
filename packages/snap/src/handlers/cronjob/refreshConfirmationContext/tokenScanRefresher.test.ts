import { createConfirmationDataContext } from './__fixtures__/context.fixtures';
import { ConfirmationContextRefresherKey } from './api';
import { ConfirmationTokenScanRefresher } from './tokenScanRefresher';
import { KnownCaip2ChainId } from '../../../api';
import type { TransactionScanService } from '../../../services/transaction-scan';
import { TokenScanResultType } from '../../../services/transaction-scan';
import { FetchStatus } from '../../../ui/confirmation/api';
import { logger } from '../../../utils/logger';

describe('ConfirmationTokenScanRefresher', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const tokenScanRequest = {
    assetReference:
      'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    origin: 'https://example.com',
    scope,
  };
  const tokenScanResult = {
    resultType: TokenScanResultType.Malicious,
    isMalicious: true,
    isWarning: false,
    name: 'USD Coin',
    symbol: 'USDC',
  };

  function setup() {
    const transactionScanService: jest.Mocked<
      Pick<TransactionScanService, 'scanToken'>
    > = {
      scanToken: jest.fn().mockResolvedValue(tokenScanResult),
    };
    const refresher = new ConfirmationTokenScanRefresher({
      logger,
      transactionScanService:
        transactionScanService as unknown as TransactionScanService,
    });

    return { refresher, transactionScanService };
  }

  function createTokenScanContext(
    overrides: Parameters<typeof createConfirmationDataContext>[0] = {},
  ) {
    return createConfirmationDataContext({
      preferences: {
        useSecurityAlerts: true,
        simulateOnChainActions: true,
      },
      tokenScanRequest,
      tokenScan: null,
      tokenScanFetchStatus: FetchStatus.Fetching,
      ...overrides,
    });
  }

  it('returns fetched token scan data and reschedules on success', async () => {
    const { refresher, transactionScanService } = setup();

    const result = await refresher.refresh(createTokenScanContext());

    expect(transactionScanService.scanToken).toHaveBeenCalledWith(
      tokenScanRequest,
    );
    expect(result).toStrictEqual({
      result: {
        tokenScan: tokenScanResult,
        tokenScanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: true,
    });
  });

  it('returns error status and stops rescheduling when scan returns null', async () => {
    const { refresher, transactionScanService } = setup();
    transactionScanService.scanToken.mockResolvedValueOnce(null);

    const result = await refresher.refresh(createTokenScanContext());

    expect(result).toStrictEqual({
      result: {
        tokenScan: null,
        tokenScanFetchStatus: FetchStatus.Error,
      },
      reschedule: false,
    });
  });

  it('does not fetch when Security Alerts are disabled', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createTokenScanContext({
          preferences: {
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
        }),
      ),
    ).toBe(false);
  });

  it('does not fetch when tokenScanRequest is missing', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createTokenScanContext({
          tokenScanRequest: undefined,
        }),
      ),
    ).toBe(false);
  });

  it('writes fetched recovery when Security Alerts are disabled', () => {
    const { refresher } = setup();

    expect(
      refresher.recoveryResult(
        createTokenScanContext({
          preferences: {
            useSecurityAlerts: false,
            simulateOnChainActions: true,
          },
        }),
      ),
    ).toStrictEqual({
      result: {
        tokenScan: null,
        tokenScanFetchStatus: FetchStatus.Fetched,
      },
      reschedule: false,
    });
  });

  it('writes recovery error when token scan prefs are enabled but request is missing', () => {
    const { refresher } = setup();

    expect(
      refresher.recoveryResult(
        createTokenScanContext({
          tokenScanRequest: undefined,
        }),
      ),
    ).toStrictEqual({
      result: {
        tokenScan: null,
        tokenScanFetchStatus: FetchStatus.Error,
      },
      reschedule: false,
    });
  });

  it('uses the token scan refresher key', () => {
    const { refresher } = setup();
    expect(refresher.key).toBe(ConfirmationContextRefresherKey.TokenScan);
  });
});
