import {
  SecurityAlertsApiClient,
  TransactionScanOption,
  TransactionScanValidationType,
} from '.';
import { KnownCaip2ChainId } from '../../api';
import {
  HttpResponseException,
  InvalidHttpRequestParamsException,
  InvalidHttpResponseException,
} from '../../utils/errors';

jest.mock('../../utils/logger');

describe('SecurityAlertsApiClient', () => {
  const baseUrl = 'https://security-alerts.api.cx.metamask.io';
  const accountAddress =
    'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE';
  const transaction =
    'AAAAAgAAAADjngeX0YTNoQ15A0xC83aMm/sDnXrmLF+apmXvdmkUugAAAGQAC3gAAAAAQQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAOZfkjSFZ31vI/Nx28cC6iAFWLWcPIvJhM2NVoxmfgVTAAAAAAAAAAAAmJaAAAAAAAAAAAA=';

  const defaultScanRequest = {
    accountAddress,
    origin: 'metamask',
    scope: KnownCaip2ChainId.Mainnet,
    transaction,
    options: [TransactionScanOption.Validation],
  };

  function setup(response: unknown = { validation: null, simulation: null }) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(response),
    });
    const client = new SecurityAlertsApiClient({ baseUrl }, fetchMock);

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

  it('throws HttpResponseException for HTTP errors', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn(),
    });
    const client = new SecurityAlertsApiClient({ baseUrl }, fetchMock);

    await expect(
      client.scanTransaction({
        accountAddress,
        origin: 'metamask',
        scope: KnownCaip2ChainId.Mainnet,
        transaction,
        options: [TransactionScanOption.Validation],
      }),
    ).rejects.toThrow(HttpResponseException);
  });

  describe('request validation', () => {
    it('throws InvalidHttpRequestParamsException when accountAddress is empty', async () => {
      const { client, fetchMock } = setup();

      await expect(
        client.scanTransaction({
          ...defaultScanRequest,
          accountAddress: '',
        }),
      ).rejects.toThrow(InvalidHttpRequestParamsException);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws InvalidHttpRequestParamsException when transaction XDR is invalid', async () => {
      const { client, fetchMock } = setup();

      await expect(
        client.scanTransaction({
          ...defaultScanRequest,
          transaction: 'not-valid-xdr',
        }),
      ).rejects.toThrow(InvalidHttpRequestParamsException);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rethrows InvalidHttpRequestParamsException without wrapping', async () => {
      const { client } = setup();

      await expect(
        client.scanTransaction({
          ...defaultScanRequest,
          accountAddress: '',
        }),
      ).rejects.toMatchObject({
        message: 'Invalid API request parameters',
        name: 'InvalidHttpRequestParamsException',
      });
    });
  });

  describe('response validation', () => {
    it('throws InvalidHttpResponseException when response body fails schema validation', async () => {
      const { client } = setup({
        validation: {
          status: 'Success',
        },
      });

      await expect(client.scanTransaction(defaultScanRequest)).rejects.toThrow(
        InvalidHttpResponseException,
      );
    });

    it('rethrows InvalidHttpResponseException without wrapping', async () => {
      const { client } = setup({
        validation: {
          status: 'Success',
        },
      });

      await expect(
        client.scanTransaction(defaultScanRequest),
      ).rejects.toMatchObject({
        message: 'Invalid API response',
        name: 'InvalidHttpResponseException',
      });
    });
  });
});
