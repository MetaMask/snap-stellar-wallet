import { KeyringHandler } from './handlers';
import { AccountService } from './services/account/AccountService';
import { AccountsRepository } from './services/account/AccountsRepository';
import { State } from './services/state/State';
import { KeypairService } from './services/wallet/KeypairService';
import { WalletService } from './services/wallet/WalletService';
import { logger } from './utils';

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
  },
});

const accountsRepository = new AccountsRepository(state);

const keypairService = new KeypairService({
  logger,
});

const walletService = new WalletService({
  logger,
});

const accountService = new AccountService({
  logger,
  keypairService,
  accountsRepository,
  walletService,
});

const keyringHandler = new KeyringHandler({
  logger,
  accountService,
});

export { keyringHandler };
