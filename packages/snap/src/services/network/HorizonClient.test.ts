/* eslint-disable @typescript-eslint/naming-convention -- Horizon wire fields use snake_case */
import { HorizonClient, HorizonNotFoundError } from './HorizonClient';

describe('HorizonClient', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches the base fee from Horizon fee stats', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ last_ledger_base_fee: '123' }));
    const client = new HorizonClient('https://horizon.example');

    const result = await client.fetchBaseFee();

    expect(result).toBe(123);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://horizon.example/fee_stats',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
    );
  });

  it('loads account responses with SDK-compatible account helpers', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        account_id: 'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
        sequence: '42',
        balances: [],
      }),
    );
    const client = new HorizonClient('https://horizon.example');

    const result = await client.loadAccount(
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
    );

    expect(result.accountId()).toBe(
      'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
    );
    expect(result.sequenceNumber()).toBe('42');
  });

  it('reads asset records from Horizon embedded collection responses', async () => {
    const assetRecord = {
      asset_code: 'USDC',
      asset_issuer: 'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
    };
    fetchMock.mockResolvedValue(
      jsonResponse({
        _embedded: {
          records: [assetRecord],
        },
      }),
    );
    const client = new HorizonClient('https://horizon.example');

    const result = await client.getAssetRecords({
      assetCode: 'USDC',
      assetIssuer: 'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
    });

    expect(result.records).toStrictEqual([assetRecord]);
  });

  it('reads transaction records from Horizon embedded collection responses', async () => {
    const transactionRecord = {
      hash: 'transaction-hash',
      source_account:
        'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
    };
    fetchMock.mockResolvedValue(
      jsonResponse({
        _links: {
          next: {
            href: '',
          },
        },
        _embedded: {
          records: [transactionRecord],
        },
      }),
    );
    const client = new HorizonClient('https://horizon.example');

    const result = await client.getTransactions({
      accountAddress:
        'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
      cursor: '',
      includeFailed: false,
      limit: 10,
      order: 'desc',
    });

    expect(result.records).toStrictEqual([transactionRecord]);
  });

  it('throws HorizonNotFoundError for 404 responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ title: 'Not Found' }, 404));
    const client = new HorizonClient('https://horizon.example');

    await expect(client.getTransaction('abc')).rejects.toThrow(
      HorizonNotFoundError,
    );
  });
});

function jsonResponse(body: unknown, status: number = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
