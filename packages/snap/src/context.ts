import { assert, object } from '@metamask/superstruct';

import { AppConfig } from './config';
import { KeyringHandler, CronjobHandler, UserInputHandler } from './handlers';
import { AssetsHandler } from './handlers/asset/assets';
import type { IClientRequestHandler } from './handlers/clientRequest';
import {
  ChangeTrustOptHandler,
  ClientRequestHandler,
  ClientRequestMethod,
} from './handlers/clientRequest';
import type { ICronjobRequestHandler } from './handlers/cronjob/api';
import { BackgroundEventMethod } from './handlers/cronjob/api';
import { RefreshConfirmationPricesHandler } from './handlers/cronjob/refreshConfirmationPrices';
import { TrackTransactionHandler } from './handlers/cronjob/trackTransaction';
import type { IKeyringRequestHandler } from './handlers/keyring';
import {
  MultichainMethod,
  SignMessageHandler,
  SignTransactionHandler,
} from './handlers/keyring';
import { AccountService, AccountsRepository } from './services/account';
import type { AccountBalanceState } from './services/account-balance';
import {
  AssetMetadataRepository,
  AssetMetadataService,
} from './services/asset-metadata';
import { InMemoryCache, StateCache } from './services/cache';
import { NetworkService } from './services/network';
import type { OnChainAccountState } from './services/on-chain-account';
import {
  OnChainAccountRepository,
  OnChainAccountService,
} from './services/on-chain-account';
import { PriceService } from './services/price';
import { State } from './services/state';
import {
  TransactionBuilder,
  TransactionRepository,
  TransactionService,
} from './services/transaction';
import { WalletService } from './services/wallet';
import { ConfirmationUXController } from './ui/confirmation/controller';
import { logger, noOpLogger } from './utils';

assert(AppConfig, object());

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
    assets: {},
    transactions: {},
    accountBalances: {} as AccountBalanceState['accountBalances'],
    onChainAccounts: {} as OnChainAccountState['onChainAccounts'],
  },
});

const accountsRepository = new AccountsRepository(state);
const transactionRepository = new TransactionRepository(state);
const assetMetadataRepository = new AssetMetadataRepository(state);

/** ------------------------------ Services  ------------------------------ */
const networkService = new NetworkService({ logger });

const assetMetadataService = new AssetMetadataService({
  networkService,
  assetMetadataRepository,
  logger,
});

const transactionBuilder = new TransactionBuilder({
  logger,
});
const walletService = new WalletService({ logger });

const accountService = new AccountService({
  logger,
  accountsRepository,
  walletService,
});

const onChainAccountRepository = new OnChainAccountRepository(state);

const onChainAccountService = new OnChainAccountService({
  logger,
  networkService,
  onChainAccountRepository,
  assetMetadataService,
});

const transactionService = new TransactionService({
  logger,
  transactionRepository,
  networkService,
  transactionBuilder,
  cache: new StateCache(state, logger, '__cache__transaction'),
});

const priceService = new PriceService({
  cache: new InMemoryCache(noOpLogger),
  logger,
});

/** UX Controller */
const confirmationUIController = new ConfirmationUXController({
  logger,
});

/** ------------------------------ Keyring Handler ------------------------------ */
const signTransactionHandler = new SignTransactionHandler({
  logger,
  accountService,
  walletService,
  transactionBuilder,
  transactionService,
  confirmationUIController,
});

const signMessageHandler = new SignMessageHandler({
  logger,
  accountService,
  walletService,
  confirmationUIController,
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

/** ------------------------------ User Handler ------------------------------ */
const userInputHandler = new UserInputHandler({
  logger,
});

/** ------------------------------ Cronjob Handler ------------------------------ */

const refreshConfirmationPricesHandler = new RefreshConfirmationPricesHandler({
  logger,
  priceService,
  confirmationUIController,
});

const trackTransactionHandler = new TrackTransactionHandler({
  logger,
});

const cronjobMethodHandlers: Record<
  BackgroundEventMethod,
  ICronjobRequestHandler
> = {
  [BackgroundEventMethod.RefreshConfirmationPrices]:
    refreshConfirmationPricesHandler,
  [BackgroundEventMethod.TrackTransaction]: trackTransactionHandler,
};

const cronjobHandler = new CronjobHandler({
  handlers: cronjobMethodHandlers,
});

/** ------------------------------ Asset Handler ------------------------------ */
const assetsHandler = new AssetsHandler({
  logger,
  assetMetadataService,
  priceService,
});

/** ------------------------------ Client Request Handlers ------------------------------ */
const changeTrustOptHandler = new ChangeTrustOptHandler({
  logger,
  accountService,
  assetMetadataService,
  onChainAccountService,
  walletService,
  transactionService,
  confirmationUIController,
});

const clientRequestMethodHandlers: Record<
  ClientRequestMethod,
  IClientRequestHandler
> = {
  [ClientRequestMethod.ChangeTrustOpt]: changeTrustOptHandler,
};

const clientRequestHandler = new ClientRequestHandler({
  logger,
  handlers: clientRequestMethodHandlers,
});

/** ------------------------------ Export Handlers ------------------------------ */
export {
  clientRequestHandler,
  cronjobHandler,
  assetsHandler,
  keyringHandler,
  userInputHandler,
  signTransactionHandler,
  signMessageHandler,
  confirmationUIController,
};
