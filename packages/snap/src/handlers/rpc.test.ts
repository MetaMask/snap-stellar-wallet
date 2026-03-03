import type { JsonRpcRequest } from '@metamask/snaps-sdk';
import { MethodNotFoundError } from '@metamask/snaps-sdk';

import { RpcHandler } from './rpc';
import { logger } from '../utils/logger';

jest.mock('../utils/logger');
jest.mock('../utils/requestResponse', () => ({
  validateOrigin: jest.fn(),
}));

describe('RpcHandler', () => {
  let rpcHandler: RpcHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    rpcHandler = new RpcHandler({ logger });
  });

  it('throws MethodNotFoundError if the method is not found', async () => {
    const request = {
      method: 'invalid',
      params: [],
      id: '1',
      jsonrpc: '2.0',
    } as JsonRpcRequest;

    await expect(rpcHandler.handle('metamask', request)).rejects.toThrow(
      MethodNotFoundError,
    );
  });
});
