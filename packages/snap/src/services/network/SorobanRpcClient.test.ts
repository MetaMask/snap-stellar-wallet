import { SorobanRpcClient } from './SorobanRpcClient';

describe('SorobanRpcClient', () => {
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

  it('sends transactions through JSON-RPC fetch', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          status: 'PENDING',
          hash: 'abc',
          latestLedger: 123,
          latestLedgerCloseTime: 456,
        },
      }),
    );
    const client = new SorobanRpcClient('https://rpc.example');

    const result = await client.sendTransaction({
      toXDR: () => 'transaction-xdr',
    } as never);

    expect(result).toStrictEqual({
      status: 'PENDING',
      hash: 'abc',
      latestLedger: 123,
      latestLedgerCloseTime: 456,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rpc.example',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: {
            transaction: 'transaction-xdr',
          },
        }),
      }),
    );
  });

  it('throws JSON-RPC errors as Error objects with code and data', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: 'transaction failed with tx_bad_seq',
          data: { result: 'tx_bad_seq' },
        },
      }),
    );
    const client = new SorobanRpcClient('https://rpc.example');

    await expect(
      client.sendTransaction({ toXDR: () => 'transaction-xdr' } as never),
    ).rejects.toMatchObject({
      name: 'SorobanJsonRpcError',
      code: -32603,
      message: 'transaction failed with tx_bad_seq',
      data: { result: 'tx_bad_seq' },
    });
  });

  it('returns not-found transaction polling responses without parsing XDR', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          status: 'NOT_FOUND',
          latestLedger: 123,
          latestLedgerCloseTime: 456,
          oldestLedger: 100,
          oldestLedgerCloseTime: 111,
        },
      }),
    );
    const client = new SorobanRpcClient('https://rpc.example');

    const result = await client.getTransaction('abc');

    expect(result).toStrictEqual({
      status: 'NOT_FOUND',
      txHash: 'abc',
      latestLedger: 123,
      latestLedgerCloseTime: 456,
      oldestLedger: 100,
      oldestLedgerCloseTime: 111,
    });
  });
});

function jsonResponse(body: unknown, status: number = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
