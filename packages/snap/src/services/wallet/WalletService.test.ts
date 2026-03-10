import {
  Account,
  NotFoundError,
  Horizon as StellarHorizon,
} from '@stellar/stellar-sdk';

import { WalletService } from './WalletService';
import { logger } from '../../utils/logger';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/fixtures';
import type { StellarKeyringAccount } from '../account/AccountsRepository';

jest.mock('../../utils/logger');

describe('WalletService', () => {
  let walletService: WalletService;
  const mockAccount = generateMockStellarKeyringAccounts(
    1,
    'entropy-source-1',
  )[0] as StellarKeyringAccount;

  beforeEach(() => {
    jest.clearAllMocks();
    walletService = new WalletService({ logger });
  });

  const getStellarHorizonClientSpies = () => {
    return {
      loadAccountSpy: jest.spyOn(
        StellarHorizon.Server.prototype,
        'loadAccount',
      ),
    };
  };

  describe('loadAccount', () => {
    it('loads an account', async () => {
      const { loadAccountSpy } = getStellarHorizonClientSpies();
      loadAccountSpy.mockResolvedValue(
        new Account(mockAccount.address, '1') as unknown as ReturnType<
          (typeof StellarHorizon.Server.prototype)['loadAccount']
        >,
      );

      const account = await walletService.loadAccount(mockAccount.address);
      expect(account).toBeInstanceOf(Account);
    });

    it('returns null if the account is not found', async () => {
      const { loadAccountSpy } = getStellarHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(
        new NotFoundError('Account not found', { response: { status: 404 } }),
      );

      const account = await walletService.loadAccount(mockAccount.address);
      expect(account).toBeNull();
    });

    it('throws an error if loading the account fails', async () => {
      const { loadAccountSpy } = getStellarHorizonClientSpies();
      loadAccountSpy.mockRejectedValue(new Error('something went wrong'));

      await expect(
        walletService.loadAccount(mockAccount.address),
      ).rejects.toThrow('Failed to load account from Stellar Network');
    });
  });
});
