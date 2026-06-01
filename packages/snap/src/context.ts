import { assert, object } from '@metamask/superstruct';

import { AppConfig } from './config';
import { KeyringHandler, CronjobHandler, UserInputHandler } from './handlers';
import { AccountResolver } from './handlers/accountResolver';
import { AssetsHandler } from './handlers/asset/assets';
import type { IClientRequestHandler } from './handlers/clientRequest';
import {
  ChangeTrustOptHandler,
  ClientRequestHandler,
  ClientRequestMethod,
} from './handlers/clientRequest';
import { ComputeFeeHandler } from './handlers/clientRequest/computeFee';
import { ConfirmSendHandler } from './handlers/clientRequest/confirmSend';
import { GetAccountAssetInfoHandler } from './handlers/clientRequest/getAccountAssetInfo';
import { OnAddressInputHandler } from './handlers/clientRequest/onAddressInput';
import { OnAmountInputHandler } from './handlers/clientRequest/onAmountInput';
import { SignAndSendTransactionHandler } from './handlers/clientRequest/signAndSendTransaction';
import type { ICronjobRequestHandler } from './handlers/cronjob/api';
import { BackgroundEventMethod } from './handlers/cronjob/api';
import {
  ConfirmationPriceRefresher,
  ConfirmationScanRefresher,
  RefreshConfirmationContextHandler,
} from './handlers/cronjob/refreshConfirmationContext';
import { SyncAccountsHandler } from './handlers/cronjob/syncAccounts';
import { TrackTransactionHandler } from './handlers/cronjob/trackTransaction';
import type { IKeyringRequestHandler } from './handlers/keyring';
import {
  MultichainMethod,
  SignAuthEntryHandler,
  SignMessageHandler,
  SignTransactionHandler,
} from './handlers/keyring';
import { AccountService, AccountsRepository } from './services/account';
import { AccountAssetInfoService } from './services/account-asset-info';
import {
  AssetMetadataRepository,
  AssetMetadataService,
} from './services/asset-metadata';
import { InMemoryCache } from './services/cache';
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
import {
  SecurityAlertsApiClient,
  TransactionScanService,
} from './services/transaction-scan';
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
    onChainAccounts: {} as OnChainAccountState['onChainAccounts'],
  },
});

const accountsRepository = new AccountsRepository(state);
const transactionRepository = new TransactionRepository(state);
const assetMetadataRepository = new AssetMetadataRepository(state);

/** ------------------------------ Services  ------------------------------ */
const appCache = new InMemoryCache(noOpLogger);
const networkService = new NetworkService({ logger, cache: appCache });

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

const accountAssetInfoService = new AccountAssetInfoService({
  logger,
  accountService,
  onChainAccountService,
  assetMetadataService,
});

const transactionService = new TransactionService({
  logger,
  transactionRepository,
  networkService,
  transactionBuilder,
});

const priceService = new PriceService({
  cache: new InMemoryCache(noOpLogger),
  logger,
});

const transactionScanService = new TransactionScanService({
  securityAlertsApiClient: new SecurityAlertsApiClient(
    AppConfig.api.securityAlertsApi,
  ),
  logger,
});

/** UX Controller */
const confirmationUIController = new ConfirmationUXController({
  logger,
});

/** ------------------------------ Account Resolver ------------------------------ */
const accountResolver = new AccountResolver({
  accountService,
  onChainAccountService,
  walletService,
});

/** ------------------------------ Keyring Handler ------------------------------ */
const signTransactionHandler = new SignTransactionHandler({
  logger,
  accountResolver,
  transactionBuilder,
  transactionService,
  confirmationUIController,
});

const signMessageHandler = new SignMessageHandler({
  logger,
  accountResolver,
  confirmationUIController,
});

const signAuthEntryHandler = new SignAuthEntryHandler({
  logger,
  accountResolver,
  confirmationUIController,
});

const keyringMethodHandlers: Record<MultichainMethod, IKeyringRequestHandler> =
  {
    [MultichainMethod.SignTransaction]: signTransactionHandler,
    [MultichainMethod.SignMessage]: signMessageHandler,
    [MultichainMethod.SignAuthEntry]: signAuthEntryHandler,
  };

const keyringHandler = new KeyringHandler({
  logger,
  accountService,
  onChainAccountService,
  transactionService,
  handlers: keyringMethodHandlers,
});

/** ------------------------------ User Handler ------------------------------ */
const userInputHandler = new UserInputHandler({
  logger,
});

/** ------------------------------ Cronjob Handler ------------------------------ */
const confirmationPriceRefresher = new ConfirmationPriceRefresher({
  logger,
  priceService,
});

const confirmationScanRefresher = new ConfirmationScanRefresher({
  logger,
  transactionScanService,
});

const refreshConfirmationContextHandler = new RefreshConfirmationContextHandler(
  {
    logger,
    confirmationUIController,
    refreshers: [confirmationPriceRefresher, confirmationScanRefresher],
  },
);

const trackTransactionHandler = new TrackTransactionHandler({
  logger,
  networkService,
  onChainAccountService,
  accountService,
  transactionService,
});

const syncAccountsHandler = new SyncAccountsHandler({
  logger,
  accountService,
  onChainAccountService,
});

const cronjobMethodHandlers: Record<
  BackgroundEventMethod,
  ICronjobRequestHandler
> = {
  [BackgroundEventMethod.RefreshConfirmationContext]:
    refreshConfirmationContextHandler,
  [BackgroundEventMethod.TrackTransaction]: trackTransactionHandler,
  [BackgroundEventMethod.SynchronizeAccounts]: syncAccountsHandler,
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
  accountResolver,
  assetMetadataService,
  transactionService,
  confirmationUIController,
});

const onAddressInputHandler = new OnAddressInputHandler({
  logger,
});

const onAmountInputHandler = new OnAmountInputHandler({
  logger,
  accountResolver,
  assetMetadataService,
  transactionService,
});

const signAndSendTransactionHandler = new SignAndSendTransactionHandler({
  logger,
  accountResolver,
  transactionService,
});

const confirmSendHandler = new ConfirmSendHandler({
  logger,
  accountResolver,
  transactionService,
  assetMetadataService,
  confirmationUIController,
});

const computeFeeHandler = new ComputeFeeHandler({
  logger,
  accountResolver,
  transactionService,
});

const getAccountAssetInfoHandler = new GetAccountAssetInfoHandler({
  logger,
  accountAssetInfoService,
});

const clientRequestMethodHandlers: Record<
  ClientRequestMethod,
  IClientRequestHandler
> = {
  [ClientRequestMethod.ChangeTrustOpt]: changeTrustOptHandler,
  [ClientRequestMethod.GetAccountAssetInfo]: getAccountAssetInfoHandler,
  [ClientRequestMethod.OnAddressInput]: onAddressInputHandler,
  [ClientRequestMethod.OnAmountInput]: onAmountInputHandler,
  [ClientRequestMethod.ConfirmSend]: confirmSendHandler,
  [ClientRequestMethod.SignAndSendTransaction]: signAndSendTransactionHandler,
  [ClientRequestMethod.ComputeFee]: computeFeeHandler,
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
  signAuthEntryHandler,
  confirmationUIController,
};
