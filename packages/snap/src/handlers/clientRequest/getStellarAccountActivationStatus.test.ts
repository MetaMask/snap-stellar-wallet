import {
  ClientRequestMethod,
  type GetStellarAccountActivationStatusJsonRpcRequest,
} from './api';
import { GetStellarAccountActivationStatusHandler } from './getStellarAccountActivationStatus';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import { NetworkService } from '../../services/network';
import { mockOnChainAccountService } from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('GetStellarAccountActivationStatusHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const scope = KnownCaip2ChainId.Mainnet;

  function buildRequest(): GetStellarAccountActivationStatusJsonRpcRequest {
    return {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.GetStellarAccountActivationStatus,
      params: { accountId, scope },
    };
  }

  it('returns activated true when Horizon has the account', async () => {
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );

    const resolveAccountSpy = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });
    const getAccountOrNullSpy = jest
      .spyOn(NetworkService.prototype, 'getAccountOrNull')
      .mockResolvedValue({} as never);

    const { accountService } = mockOnChainAccountService();
    const networkService = new NetworkService({ logger });
    const handler = new GetStellarAccountActivationStatusHandler({
      logger,
      accountService,
      networkService,
    });

    expect(await handler.handle(buildRequest())).toStrictEqual({
      activated: true,
    });

    expect(resolveAccountSpy).toHaveBeenCalledWith({ accountId });
    expect(getAccountOrNullSpy).toHaveBeenCalledWith(account.address, scope);
  });

  it('returns activated false when Horizon has no account', async () => {
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );

    jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });
    const getAccountOrNullSpy = jest
      .spyOn(NetworkService.prototype, 'getAccountOrNull')
      .mockResolvedValue(null);

    const { accountService } = mockOnChainAccountService();
    const networkService = new NetworkService({ logger });
    const handler = new GetStellarAccountActivationStatusHandler({
      logger,
      accountService,
      networkService,
    });

    expect(await handler.handle(buildRequest())).toStrictEqual({
      activated: false,
    });

    expect(getAccountOrNullSpy).toHaveBeenCalledWith(account.address, scope);
  });
});
