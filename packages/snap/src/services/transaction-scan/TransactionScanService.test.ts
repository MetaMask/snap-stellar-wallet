import {
  AssetChangeDirection,
  TransactionScanOption,
  TransactionScanValidationType,
} from './api';
import type { SecurityAlertsApiClient } from './SecurityAlertsApiClient';
import { TransactionScanService } from './TransactionScanService';
/* eslint-disable @typescript-eslint/naming-convention */
import { KnownCaip2ChainId } from '../../api';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('TransactionScanService', () => {
  const accountAddress =
    'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE';
  const scanParams = {
    accountAddress,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    transaction: 'AAAAAgAAAAA=',
    options: [TransactionScanOption.Validation],
  };

  function setup() {
    const securityAlertsApiClient: jest.Mocked<
      Pick<SecurityAlertsApiClient, 'scanTransaction'>
    > = {
      scanTransaction: jest.fn(),
    };
    const service = new TransactionScanService({
      securityAlertsApiClient:
        securityAlertsApiClient as unknown as SecurityAlertsApiClient,
      logger,
    });

    return {
      service,
      securityAlertsApiClient,
    };
  }

  it('maps successful validation and simulation responses', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      validation: {
        status: 'Success',
        result_type: TransactionScanValidationType.Warning,
        reason: 'known_attacker',
        description: 'Known attacker involved',
      },
      simulation: {
        status: 'Success',
        account_summary: {
          account_assets_diffs: [
            {
              asset: {
                code: 'XLM',
              },
              asset_type: 'NATIVE',
              out: {
                raw_value: 10000000,
                value: 1,
                usd_price: 0.1,
              },
            },
          ],
        },
      },
    });

    const result = await service.scanTransactionSafe(scanParams);

    expect(result).toStrictEqual({
      status: 'SUCCESS',
      estimatedChanges: {
        assets: [
          {
            type: AssetChangeDirection.Out,
            symbol: 'XLM',
            name: 'XLM',
            logo: null,
            value: 1,
            price: 0.1,
          },
        ],
      },
      validation: {
        type: TransactionScanValidationType.Warning,
        reason: 'known_attacker',
        description: 'Known attacker involved',
      },
      error: null,
    });
  });

  it('reads the signer asset diffs from assets_diffs when account_summary is empty', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Success',
        // Blockaid leaves the aggregate empty but populates per-account diffs.
        account_summary: { account_assets_diffs: [] },
        assets_diffs: {
          [accountAddress]: [
            {
              asset: { type: 'NATIVE', code: 'XLM' },
              asset_type: 'NATIVE',
              in: null,
              out: { raw_value: 5000000, value: 0, summary: 'Sent 0.5 XLM' },
            },
          ],
        },
      },
      validation: null,
    });

    const result = await service.scanTransactionSafe({
      ...scanParams,
      options: [TransactionScanOption.Simulation],
    });

    const change = result?.estimatedChanges.assets[0];
    expect(change?.symbol).toBe('XLM');
    expect(change?.type).toBe(AssetChangeDirection.Out);
    // raw_value wins over the rounded `value: 0`.
    expect(change?.value).toBe(0.5);
  });

  it('resolves an icon for classic issued assets from their code and issuer', async () => {
    const { service, securityAlertsApiClient } = setup();
    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Success',
        account_summary: {
          account_assets_diffs: [
            {
              asset: { code: 'USDC', issuer, type: 'ASSET' },
              asset_type: 'ASSET',
              out: { raw_value: 1000000, value: 0.1, usd_price: 0.1 },
            },
          ],
        },
      },
      validation: null,
    });

    const result = await service.scanTransactionSafe({
      ...scanParams,
      options: [TransactionScanOption.Simulation],
    });

    const change = result?.estimatedChanges.assets[0];
    expect(change?.symbol).toBe('USDC');
    // Icon is derived from the classic asset id (code-issuer), not returned by Blockaid.
    expect(change?.logo).toContain(`USDC-${issuer}`);
    // Decimals resolve from the classic classification, so raw_value wins.
    expect(change?.value).toBe(0.1);
  });

  it('maps API simulation errors', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Error',
        error: 'insufficient_balance',
      },
      validation: null,
    });

    const result = await service.scanTransactionSafe(scanParams);

    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'simulation',
        code: 'insufficient_balance',
        message: 'insufficient_balance',
      },
    });
  });

  it('prioritizes the simulation revert over a validation error', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Error',
        error: 'insufficient_balance',
      },
      validation: {
        status: 'Error',
        error: 'known_attacker',
      },
    });

    const result = await service.scanTransactionSafe({
      ...scanParams,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });

    // A validation `Error` only means no verdict was produced (malicious comes
    // from a validation `Success`), so the actionable simulation revert reason
    // is surfaced instead of masking it behind a security failure.
    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'simulation',
        code: 'insufficient_balance',
        message: 'insufficient_balance',
      },
    });
  });

  it('returns error when requested scan results are missing', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: null,
      validation: null,
    });

    const result = await service.scanTransactionSafe(scanParams);

    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'response',
        code: 'empty',
        message: 'No scan results returned',
      },
    });
  });

  it('preserves successful partial scan results when another requested result is missing', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: null,
      validation: {
        status: 'Success',
        result_type: TransactionScanValidationType.Benign,
      },
    });

    const result = await service.scanTransactionSafe({
      ...scanParams,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });

    expect(result).toStrictEqual({
      status: 'SUCCESS',
      estimatedChanges: {
        assets: [],
      },
      validation: {
        type: TransactionScanValidationType.Benign,
        reason: null,
        description: null,
      },
      error: null,
    });
  });

  it('keeps free-form API errors as messages instead of codes', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Error',
        error: 'Could not simulate transaction: account not found',
      },
      validation: null,
    });

    const result = await service.scanTransactionSafe(scanParams);

    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'simulation',
        code: null,
        message: 'Could not simulate transaction: account not found',
      },
    });
  });

  it('returns null when the client throws', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockRejectedValue(
      new Error('network error'),
    );

    const result = await service.scanTransactionSafe(scanParams);
    expect(result).toBeNull();
  });

  describe('estimated changes decimal precision', () => {
    it('computes display value from raw_value for fractional native XLM', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [
              {
                asset: { type: 'NATIVE', code: 'XLM' },
                asset_type: 'NATIVE',
                out: {
                  raw_value: 5000000,
                  value: 0,
                  usd_price: 0.11,
                },
              },
            ],
          },
        },
        validation: null,
      });

      const result = await service.scanTransactionSafe({
        ...scanParams,
        options: [TransactionScanOption.Simulation],
      });

      expect(result?.estimatedChanges.assets[0]?.value).toBe(0.5);
    });

    it('computes display value from raw_value when value is rounded', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [
              {
                asset: { type: 'NATIVE', code: 'XLM' },
                asset_type: 'NATIVE',
                out: {
                  raw_value: 15000000,
                  value: 2,
                  usd_price: 0.33,
                },
              },
            ],
          },
        },
        validation: null,
      });

      const result = await service.scanTransactionSafe({
        ...scanParams,
        options: [TransactionScanOption.Simulation],
      });

      expect(result?.estimatedChanges.assets[0]?.value).toBe(1.5);
    });

    it('falls back to value when asset decimals are unknown', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [
              {
                asset: {
                  type: 'CONTRACT',
                  address:
                    'CASUP2OPFVEHCWGP2XLBXOV7DQIQIT42AQISG4MXAZGNLVFFN63X7WRT',
                  symbol: 'USDC',
                  name: 'USD Coin',
                },
                asset_type: 'CONTRACT',
                out: {
                  raw_value: 1500000,
                  value: 1.5,
                  usd_price: 1.5,
                },
              },
            ],
          },
        },
        validation: null,
      });

      const result = await service.scanTransactionSafe({
        ...scanParams,
        options: [TransactionScanOption.Simulation],
      });

      expect(result?.estimatedChanges.assets[0]?.value).toBe(1.5);
    });
  });
});
