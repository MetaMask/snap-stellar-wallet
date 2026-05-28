import { TransactionScanOption, TransactionScanValidationType } from './api';
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

    const result = await service.scanTransaction(scanParams);

    expect(result).toStrictEqual({
      status: 'SUCCESS',
      estimatedChanges: {
        assets: [
          {
            type: 'out',
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

  it('maps API simulation errors', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: {
        status: 'Error',
        error: 'insufficient_balance',
      },
      validation: null,
    });

    const result = await service.scanTransaction(scanParams);

    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'simulation',
        code: 'insufficient_balance',
        message: 'insufficient_balance',
      },
    });
  });

  it('prioritizes validation errors over simulation errors', async () => {
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

    const result = await service.scanTransaction({
      ...scanParams,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });

    expect(result).toMatchObject({
      status: 'ERROR',
      error: {
        type: 'validation',
        code: 'known_attacker',
        message: 'known_attacker',
      },
    });
  });

  it('returns error when requested scan results are missing', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue({
      simulation: null,
      validation: null,
    });

    const result = await service.scanTransaction(scanParams);

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

    const result = await service.scanTransaction({
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

    const result = await service.scanTransaction(scanParams);

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

    const result = await service.scanTransaction(scanParams);
    expect(result).toBeNull();
  });
});
