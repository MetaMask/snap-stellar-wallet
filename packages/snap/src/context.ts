import { KeyringHandler } from './handlers';
import { AccountService } from './services/account/AccountService';
import { AccountsRepository } from './services/account/AccountsRepository';
import { createAccountDeriver } from './services/account/derivation';
import { State } from './services/state/State';
import { NetworkService } from './services/wallet/NetworkService';
import { TransactionBuilder } from './services/wallet/TransactionBuilder';
import { WalletService } from './services/wallet/WalletService';
import { logger } from './utils';

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
  },
});

const accountsRepository = new AccountsRepository(state);

const accountDeriver = createAccountDeriver(logger);

const networkService = new NetworkService({ logger });
const transactionBuilder = new TransactionBuilder({
  logger,
});

const walletService = new WalletService({
  logger,
  deriver: accountDeriver,
  networkService,
  transactionBuilder,
});

const accountService = new AccountService({
  logger,
  accountsRepository,
  walletService,
});

const keyringHandler = new KeyringHandler({
  logger,
  accountService,
});

export { keyringHandler };
