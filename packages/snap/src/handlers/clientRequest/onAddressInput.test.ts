import type { JsonRpcRequest } from '@metamask/utils';

import { ClientRequestMethod, MultiChainSendErrorCodes } from './api';
import type { OnAddressInputJsonRpcRequest } from './api';
import { OnAddressInputHandler } from './onAddressInput';

jest.mock('../../utils/logger');

const stellarAddress =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

describe('OnAddressInputHandler', () => {
  const handler = new OnAddressInputHandler();

  it('returns valid when the address passes validation', async () => {
    const request: OnAddressInputJsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.OnAddressInput,
      params: { value: stellarAddress },
    };

    expect(await handler.handle(request)).toStrictEqual({
      valid: true,
      errors: [],
    });
  });

  it.each<JsonRpcRequest>([
    {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.OnAddressInput,
      params: { value: 'not-a-stellar-address' },
    },
    {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.OnAmountInput,
      params: { value: stellarAddress },
    },
    {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.OnAddressInput,
      params: {},
    },
  ])('returns invalid when the request fails validation', async (request) => {
    expect(await handler.handle(request)).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });
});
