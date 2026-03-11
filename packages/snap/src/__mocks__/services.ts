import { AccountService } from '../services/account/AccountService';
import { AccountsRepository } from '../services/account/AccountsRepository';
import { State } from '../services/state/State';
import { KeypairService } from '../services/wallet/KeypairService';
import { WalletService } from '../services/wallet/WalletService';
import { logger } from '../utils/logger';

export const mockAccountService = () => {
  const accountService = new AccountService({
    logger,
    keypairService: new KeypairService({ logger }),
    accountsRepository: new AccountsRepository(
      new State({
        encrypted: false,
        defaultState: {
          keyringAccounts: {},
        },
      }),
    ),
    walletService: new WalletService({ logger }),
  });

  return {
    accountService,
  };
};
