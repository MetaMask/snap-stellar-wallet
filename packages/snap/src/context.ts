import { KeyringHandler } from './handlers';
import { AccountService } from './services/account/AccountService';
import { AccountsRepository } from './services/account/AccountsRepository';
import { State } from './services/state/State';
import { KeypairService } from './services/wallet/KeypairService';
import { logger } from './utils';

const keypairService = new KeypairService({
  logger,
});

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
  },
});

const accountsRepository = new AccountsRepository(state);

const accountService = new AccountService({
  logger,
  keypairService,
  accountsRepository,
});

const keyringHandler = new KeyringHandler({
  logger,
  accountService,
});

export { keyringHandler };
