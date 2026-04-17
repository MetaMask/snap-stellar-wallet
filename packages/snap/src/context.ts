import { assert, object } from '@metamask/superstruct';

import { AppConfig } from './config';
import { KeyringHandler } from './handlers';
import type { IKeyringRequestHandler } from './handlers/keyring';
import {
  MultichainMethod,
  SignMessageHandler,
  SignTransactionHandler,
} from './handlers/keyring';
import { UserInputHandler } from './handlers/user-input/userInput';
import { AccountService, AccountsRepository } from './services/account';
import type { AccountBalanceState } from './services/account-balance';
import {
  AssetMetadataRepository,
  AssetMetadataService,
} from './services/asset-metadata';
import { NetworkService } from './services/network';
import type { OnChainAccountSnapshotState } from './services/on-chain-account';
import { OnChainAccountService } from './services/on-chain-account';
import { State } from './services/state';
import {
  TransactionBuilder,
  TransactionRepository,
  TransactionService,
} from './services/transaction';
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
const transactionRepository = new TransactionRepository(state);
const assetMetadataRepository = new AssetMetadataRepository(state);

/** ------------------------------ Services  ------------------------------ */
const networkService = new NetworkService({ logger });
const transactionBuilder = new TransactionBuilder({
  logger,
});
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

const transactionService = new TransactionService({
  logger,
  transactionRepository,
  networkService,
});

const assetMetadataService = new AssetMetadataService({
  networkService,
  assetMetadataRepository,
  logger,
});

/** ------------------------------ Keyring Handler ------------------------------ */

const signTransactionHandler = new SignTransactionHandler({
  logger,
  accountService,
  onChainAccountService,
  walletService,
  transactionBuilder,
  transactionService,
});

const signMessageHandler = new SignMessageHandler({
  logger,
  accountService,
  onChainAccountService,
  walletService,
});

const keyringMethodHandlers: Record<MultichainMethod, IKeyringRequestHandler> =
  {
    [MultichainMethod.SignTransaction]: signTransactionHandler,
    [MultichainMethod.SignMessage]: signMessageHandler,
  };

const keyringHandler = new KeyringHandler({
  logger,
  accountService,
  onChainAccountService,
  transactionService,
  assetMetadataService,
  handlers: keyringMethodHandlers,
});

const userInputHandler = new UserInputHandler({
  logger,
});

export {
  keyringHandler,
  userInputHandler,
  signTransactionHandler,
  signMessageHandler,
};
