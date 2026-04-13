import { assert, object } from '@metamask/superstruct';

import { AppConfig } from './config';
import { KeyringHandler } from './handlers';
import { AccountService, AccountsRepository } from './services/account';
import type { AccountBalanceState } from './services/account-balance';
import { NetworkService } from './services/network';
import type { OnChainAccountSnapshotState } from './services/on-chain-account';
import { OnChainAccountService } from './services/on-chain-account';
import { State } from './services/state';
import { WalletService } from './services/wallet';
import { logger } from './utils';

assert(AppConfig, object());

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
    assets: {},
    transactions: {},
    accountBalances: {} as AccountBalanceState['accountBalances'],
    accountMetadata: {} as OnChainAccountSnapshotState['accountMetadata'],
  },
});

const accountsRepository = new AccountsRepository(state);

/** ------------------------------ Services  ------------------------------ */
const networkService = new NetworkService({ logger });

const walletService = new WalletService({ logger });

const accountService = new AccountService({
  logger,
  accountsRepository,
  walletService,
});

const onChainAccountService = new OnChainAccountService({
  networkService,
  accountService,
});

/** ------------------------------ Keyring Handler ------------------------------ */
const keyringHandler = new KeyringHandler({
  logger,
  accountService,
  onChainAccountService,
});

export { keyringHandler };
