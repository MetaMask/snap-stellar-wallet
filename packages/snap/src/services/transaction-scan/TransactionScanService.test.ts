/* eslint-disable @typescript-eslint/naming-convention */
import { Networks } from '@stellar/stellar-sdk';

import {
  insufficientBalanceResponse,
  noTrustlineResponse,
  successPaymentSEP41Response,
  successPaymentUSDCResponse,
  successPaymentXLMResponse,
  successSwapXLMToUSDCResponse,
} from './__mocks__/security-alerts-api-response.fixture';
import {
  AssetChangeDirection,
  TransactionScanErrorId,
  TransactionScanOption,
  TransactionScanValidationType,
} from './api';
import type { StellarTransactionScanResponse } from './api';
import type { SecurityAlertsApiClient } from './SecurityAlertsApiClient';
import { TransactionScanService } from './TransactionScanService';
import { KnownCaip2ChainId } from '../../api';
import { xlmIcon } from '../../ui/images';
import { toCaip19ClassicAssetId, toCaip19Sep41AssetId } from '../../utils';
import { logger } from '../../utils/logger';
import { getIconUrl } from '../asset-metadata/utils';
import { buildMockClassicTransaction } from '../transaction/__mocks__/transaction.fixtures';

jest.mock('../../utils/logger');

const FIXTURE_ACCOUNT_ADDRESS =
  'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SEP41_ADDRESS =
  'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN';

describe('TransactionScanService', () => {
  const scanParams = {
    accountAddress: FIXTURE_ACCOUNT_ADDRESS,
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    transaction: 'AAAAAgAAAAA=',
    options: [
      TransactionScanOption.Simulation,
      TransactionScanOption.Validation,
    ],
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

  describe('security alerts API fixtures', () => {
    it('maps insufficient balance simulation revert', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        insufficientBalanceResponse as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toMatchObject({
        status: 'ERROR',
        estimatedChanges: { assets: [] },
        validation: null,
        error: {
          type: 'simulation',
          code: TransactionScanErrorId.InsufficientBalance,
          message: insufficientBalanceResponse.simulation.error,
        },
      });
    });

    it('maps no trustline simulation revert', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        noTrustlineResponse as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toMatchObject({
        status: 'ERROR',
        estimatedChanges: { assets: [] },
        validation: null,
        error: {
          type: 'simulation',
          code: TransactionScanErrorId.NoTrustline,
          message: noTrustlineResponse.simulation.error,
        },
      });
    });

    it('maps XLM to USDC swap simulation and benign validation', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        successSwapXLMToUSDCResponse as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toStrictEqual({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'XLM',
              name: 'XLM',
              logo: xlmIcon,
              value: '2',
              price: 0.36,
            },
            {
              type: AssetChangeDirection.In,
              symbol: 'USDC',
              name: 'USDC',
              logo: getIconUrl(
                toCaip19ClassicAssetId(
                  KnownCaip2ChainId.Mainnet,
                  'USDC',
                  USDC_ISSUER,
                ),
              ),
              value: '1',
              price: 1,
            },
          ],
        },
        validation: {
          type: TransactionScanValidationType.Benign,
          reason: '',
          description: '',
        },
        error: null,
      });
    });

    it('maps native XLM payment simulation', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        successPaymentXLMResponse as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toStrictEqual({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'XLM',
              name: 'XLM',
              logo: xlmIcon,
              value: '1',
              price: 0.18,
            },
          ],
        },
        validation: {
          type: TransactionScanValidationType.Benign,
          reason: '',
          description: '',
        },
        error: null,
      });
    });

    it('maps classic USDC payment with sub-unit amount', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        successPaymentUSDCResponse as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toStrictEqual({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'USDC',
              name: 'USDC',
              logo: getIconUrl(
                toCaip19ClassicAssetId(
                  KnownCaip2ChainId.Mainnet,
                  'USDC',
                  USDC_ISSUER,
                ),
              ),
              value: '0.000001',
              price: 0,
            },
          ],
        },
        validation: {
          type: TransactionScanValidationType.Benign,
          reason: '',
          description: '',
        },
        error: null,
      });
    });

    it('maps SEP-41 token payment with token decimals', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue(
        successPaymentSEP41Response as StellarTransactionScanResponse,
      );

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toStrictEqual({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'SolvBTC',
              name: 'Solv BTC',
              logo: getIconUrl(
                toCaip19Sep41AssetId(KnownCaip2ChainId.Mainnet, SEP41_ADDRESS),
              ),
              value: '0.00000001',
              price: 0,
            },
          ],
        },
        validation: {
          type: TransactionScanValidationType.Benign,
          reason: '',
          description: '',
        },
        error: null,
      });
    });
  });

  it('prioritizes the simulation revert over a validation error', async () => {
    const { service, securityAlertsApiClient } = setup();
    securityAlertsApiClient.scanTransaction.mockResolvedValue(
      insufficientBalanceResponse as StellarTransactionScanResponse,
    );

    const result = await service.scanTransactionSafe(scanParams);

    expect(result?.error).toMatchObject({
      type: 'simulation',
      code: TransactionScanErrorId.InsufficientBalance,
    });
  });

  it('maps API simulation errors with machine-readable codes', async () => {
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

    const result = await service.scanTransactionSafe(scanParams);

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
        code: TransactionScanErrorId.InvalidTransaction,
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

  describe('preflight validation', () => {
    it('returns a transaction expired error when the time bound has passed', async () => {
      const { service, securityAlertsApiClient } = setup();
      const mockNow = 1_700_000_000_000;
      jest.useFakeTimers();
      jest.setSystemTime(mockNow);

      try {
        const expiredTransaction = buildMockClassicTransaction(
          [
            {
              type: 'payment',
              params: {
                destination: FIXTURE_ACCOUNT_ADDRESS,
                asset: 'native',
                amount: '1',
              },
            },
          ],
          { networkPassphrase: Networks.PUBLIC, timeout: 1 },
        );
        jest.advanceTimersByTime(2000);

        securityAlertsApiClient.scanTransaction.mockResolvedValue({
          simulation: {
            status: 'Success',
            account_summary: {
              account_assets_diffs: [],
            },
            assets_diffs: {},
          },
          validation: {
            status: 'Success',
            result_type: TransactionScanValidationType.Benign,
          },
        });

        const result = await service.scanTransactionSafe({
          ...scanParams,
          transaction: expiredTransaction.getRaw().toXDR(),
        });

        expect(result).toMatchObject({
          status: 'ERROR',
          error: {
            type: 'simulation',
            code: TransactionScanErrorId.TransactionExpired,
            message: 'Transaction expired',
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not block scan when XDR cannot be parsed locally', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [],
          },
          assets_diffs: {},
        },
        validation: {
          status: 'Success',
          result_type: TransactionScanValidationType.Benign,
        },
      });

      const result = await service.scanTransactionSafe({
        ...scanParams,
        transaction: 'AAAAAgAAAAA=',
      });

      expect(result).toMatchObject({
        status: 'SUCCESS',
        error: null,
      });
    });

    it('prioritizes simulation revert over preflight expiration error', async () => {
      const { service, securityAlertsApiClient } = setup();
      const mockNow = 1_700_000_000_000;
      jest.useFakeTimers();
      jest.setSystemTime(mockNow);

      try {
        const expiredTransaction = buildMockClassicTransaction(
          [
            {
              type: 'payment',
              params: {
                destination: FIXTURE_ACCOUNT_ADDRESS,
                asset: 'native',
                amount: '1',
              },
            },
          ],
          { networkPassphrase: Networks.PUBLIC, timeout: 1 },
        );
        jest.advanceTimersByTime(2000);

        securityAlertsApiClient.scanTransaction.mockResolvedValue(
          insufficientBalanceResponse as StellarTransactionScanResponse,
        );

        const result = await service.scanTransactionSafe({
          ...scanParams,
          transaction: expiredTransaction.getRaw().toXDR(),
        });

        expect(result?.error).toMatchObject({
          type: 'simulation',
          code: TransactionScanErrorId.InsufficientBalance,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns estimated changes when preflight reports expiration but simulation succeeds', async () => {
      const { service, securityAlertsApiClient } = setup();
      const mockNow = 1_700_000_000_000;
      jest.useFakeTimers();
      jest.setSystemTime(mockNow);

      try {
        const expiredTransaction = buildMockClassicTransaction(
          [
            {
              type: 'payment',
              params: {
                destination: FIXTURE_ACCOUNT_ADDRESS,
                asset: 'native',
                amount: '1',
              },
            },
          ],
          { networkPassphrase: Networks.PUBLIC, timeout: 1 },
        );
        jest.advanceTimersByTime(2000);

        securityAlertsApiClient.scanTransaction.mockResolvedValue(
          successPaymentXLMResponse as StellarTransactionScanResponse,
        );

        const result = await service.scanTransactionSafe({
          ...scanParams,
          transaction: expiredTransaction.getRaw().toXDR(),
        });

        expect(result).toMatchObject({
          status: 'ERROR',
          error: {
            code: TransactionScanErrorId.TransactionExpired,
          },
          estimatedChanges: {
            assets: [
              {
                type: AssetChangeDirection.Out,
                symbol: 'XLM',
                value: '1',
              },
            ],
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('estimated change mapping', () => {
    it('omits unsupported asset types from estimated changes', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [],
          },
          assets_diffs: {
            [FIXTURE_ACCOUNT_ADDRESS]: [
              {
                asset: {
                  type: 'POOL_SHARE',
                },
                asset_type: 'POOL_SHARE',
                in: null,
                out: {
                  usd_price: 1,
                  summary: 'Sent pool share',
                  value: 1,
                  raw_value: 10000000,
                },
              },
              {
                asset: {
                  type: 'NATIVE',
                  code: 'XLM',
                },
                asset_type: 'NATIVE',
                in: null,
                out: {
                  usd_price: 0.18,
                  summary: 'Sent 1 XLM',
                  value: 1,
                  raw_value: 10000000,
                },
              },
            ],
          },
        },
        validation: {
          status: 'Success',
          result_type: TransactionScanValidationType.Benign,
        },
      } as StellarTransactionScanResponse);

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toMatchObject({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'XLM',
              name: 'XLM',
              logo: xlmIcon,
              value: '1',
              price: 0.18,
            },
          ],
        },
      });
    });

    it('maps null value when raw_value is missing from the transfer', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [],
          },
          assets_diffs: {
            [FIXTURE_ACCOUNT_ADDRESS]: [
              {
                asset: {
                  type: 'NATIVE',
                  code: 'XLM',
                },
                asset_type: 'NATIVE',
                in: null,
                out: {
                  usd_price: 0.18,
                  summary: 'Sent 1 XLM',
                  value: 1,
                },
              },
            ],
          },
        },
        validation: {
          status: 'Success',
          result_type: TransactionScanValidationType.Benign,
        },
      } as unknown as StellarTransactionScanResponse);

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toMatchObject({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [
            {
              type: AssetChangeDirection.Out,
              symbol: 'XLM',
              value: null,
              price: 0.18,
            },
          ],
        },
      });
    });

    it('reads signer diffs from assets_diffs instead of account_summary', async () => {
      const { service, securityAlertsApiClient } = setup();
      securityAlertsApiClient.scanTransaction.mockResolvedValue({
        simulation: {
          status: 'Success',
          account_summary: {
            account_assets_diffs: [
              {
                asset: {
                  type: 'NATIVE',
                  code: 'XLM',
                },
                asset_type: 'NATIVE',
                in: null,
                out: {
                  usd_price: 0.18,
                  summary: 'Sent 1 XLM',
                  value: 1,
                  raw_value: 10000000,
                },
              },
            ],
          },
          assets_diffs: {},
        },
        validation: {
          status: 'Success',
          result_type: TransactionScanValidationType.Benign,
        },
      } as StellarTransactionScanResponse);

      const result = await service.scanTransactionSafe(scanParams);

      expect(result).toMatchObject({
        status: 'SUCCESS',
        estimatedChanges: {
          assets: [],
        },
      });
    });
  });
});
