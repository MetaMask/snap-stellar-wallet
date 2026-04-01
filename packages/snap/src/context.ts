import { KeyringHandler, ClientRequestHandler } from './handlers';
import {
  AccountService,
  AccountsRepository,
  createAccountDeriver,
} from './services/account';
import { State } from './services/state/State';
import {
  NetworkService,
  TransactionBuilder,
  WalletService,
} from './services/wallet';
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
});

const clientRequestHandler = new ClientRequestHandler({
  logger,
  accountService,
  walletService,
});

export { keyringHandler, clientRequestHandler };
