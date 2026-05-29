/* eslint-disable @typescript-eslint/naming-convention */
import {
  SecurityAlertsApiClient,
  TransactionScanException,
  TransactionScanOption,
  TransactionScanValidationType,
} from '.';
import { KnownCaip2ChainId } from '../../api';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('SecurityAlertsApiClient', () => {
  const baseUrl = 'https://security-alerts.api.cx.metamask.io';
  const accountAddress =
    'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE';
  const transaction = 'AAAAAgAAAAA=';

  function setup(response: unknown = { validation: null, simulation: null }) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(response),
    });
    const client = new SecurityAlertsApiClient(
      { baseUrl },
      logger,
      fetchMock as unknown as typeof globalThis.fetch,
    );

    return {
      client,
      fetchMock,
    };
  }

  it('posts a Stellar transaction scan request', async () => {
    const { client, fetchMock } = setup({
      validation: {
        status: 'Success',
        result_type: TransactionScanValidationType.Benign,
      },
      simulation: null,
    });

    await client.scanTransaction({
      accountAddress,
      origin: 'https://example.com/path',
      scope: KnownCaip2ChainId.Mainnet,
      transaction,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/stellar/transaction/scan`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toStrictEqual({
      account_address: accountAddress,
      chain: 'pubnet',
      metadata: {
        type: 'wallet',
        url: 'https://example.com',
      },
      transaction,
      options: [
        TransactionScanOption.Simulation,
        TransactionScanOption.Validation,
      ],
    });
  });

  it('uses in-app metadata for non-url origins', async () => {
    const { client, fetchMock } = setup();

    await client.scanTransaction({
      accountAddress,
      origin: 'metamask',
      scope: KnownCaip2ChainId.Testnet,
      transaction,
      options: [TransactionScanOption.Validation],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      chain: 'testnet',
      metadata: { type: 'in_app' },
    });
  });

  it('throws TransactionScanException for HTTP errors', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn(),
    });
    const client = new SecurityAlertsApiClient(
      { baseUrl },
      logger,
      fetchMock as unknown as typeof globalThis.fetch,
    );

    await expect(
      client.scanTransaction({
        accountAddress,
        origin: 'metamask',
        scope: KnownCaip2ChainId.Mainnet,
        transaction,
        options: [TransactionScanOption.Validation],
      }),
    ).rejects.toThrow(TransactionScanException);
  });
});
