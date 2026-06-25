import {
  KeyringEvent,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { groupBy } from 'lodash';

import { InsufficientBalanceException } from './exceptions';
import type { KeyringTransactionRequest } from './KeyringTransactionBuilder';
import { KeyringTransactionBuilder } from './KeyringTransactionBuilder';
import { Transaction } from './Transaction';
import type { TransactionBuilder } from './TransactionBuilder';
import { TransactionMapper } from './TransactionMapper';
import type { TransactionRepository } from './TransactionRepository';
import {
  SupportedOperations,
  TransactionSimulator,
  type TransactionSimulatorOptions,
} from './TransactionSimulator';
import { TransactionSynchronizeService } from './TransactionSynchronizeService';
import { assertTransactionScope } from './utils';
import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip19ClassicAssetId,
  KnownCaip19Sep41AssetId,
  KnownCaip19Slip44Id,
  KnownCaip2ChainId,
} from '../../api';
import {
  getSnapProvider,
  isSep41Id,
  isSlip44Id,
  trackError,
} from '../../utils';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { AccountService } from '../account';
import type { StellarAssetMetadata } from '../asset-metadata';
import type { NetworkService } from '../network';
import {
  AccountNotActivatedException,
  TransactionRetryableException,
} from '../network/exceptions';
import type { OnChainAccount } from '../on-chain-account/OnChainAccount';
import type { ActivatedAccountPair } from '../sync/api';
import type { Wallet } from '../wallet';

export class TransactionService {
  readonly #logger: ILogger;

  readonly #transactionRepository: TransactionRepository;

  readonly #networkService: NetworkService;

  readonly #transactionBuilder: TransactionBuilder;

  readonly #keyringTransactionBuilder: KeyringTransactionBuilder;

  readonly #transactionSynchronizeService: TransactionSynchronizeService;

  constructor({
    logger,
    transactionRepository,
    networkService,
    transactionBuilder,
    accountService,
  }: {
    logger: ILogger;
    transactionRepository: TransactionRepository;
    networkService: NetworkService;
    transactionBuilder: TransactionBuilder;
    accountService: AccountService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🧾 TransactionService]');
    this.#transactionRepository = transactionRepository;
    this.#networkService = networkService;
    this.#transactionBuilder = transactionBuilder;
    this.#keyringTransactionBuilder = new KeyringTransactionBuilder();
    const transactionMapper = new TransactionMapper({
      keyringTransactionBuilder: this.#keyringTransactionBuilder,
      logger,
    });
    this.#transactionSynchronizeService = new TransactionSynchronizeService({
      networkService,
      transactionRepository,
      transactionMapper,
      accountService,
      logger,
    });
  }

  /**
   * Gets the keyring transaction builder.
   *
   * @returns The keyring transaction builder.
   */
  get keyringTransactionBuilder(): KeyringTransactionBuilder {
    return this.#keyringTransactionBuilder;
  }

  /**
   * Gets the base fee for a transaction.
   *
   * @param scope - The CAIP-2 chain ID.
   * @returns A promise that resolves to the base fee.
   */
  async getBaseFee(scope: KnownCaip2ChainId): Promise<BigNumber> {
    return this.#networkService.getBaseFeeWithCache(scope);
  }

  /**
   * Creates a validated change trust transaction.
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 classic asset ID.
   * @param params.limit - The limit for the trustline, 0 for delete trustline.
   *
   * @returns A promise that resolves to the validated transaction.
   */
  async createValidatedChangeTrustTransaction(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19ClassicAssetId;
    limit?: string;
  }): Promise<Transaction> {
    const { onChainAccount, scope, assetId, limit } = params;

    const baseFee = await this.getBaseFee(scope);

    const transaction = this.#transactionBuilder.changeTrust({
      onChainAccount,
      assetId,
      scope,
      baseFee: baseFee.toString(),
      limit,
    });

    this.validateTransaction(transaction, onChainAccount, {
      expectedOPTypes: [SupportedOperations.ChangeTrust],
    });

    return transaction;
  }

  /**
   * Creates a validated send transaction.
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.amount - The amount to send.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 asset ID.
   * @param params.destination - The destination address.
   * @param params.useCache - Whether to use the cache.
   * @returns A promise that resolves to the validated transaction.
   */
  async createValidatedSendTransaction(params: {
    onChainAccount: OnChainAccount;
    amount: BigNumber;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19AssetIdOrSlip44Id;
    destination: string;
    useCache?: boolean;
  }): Promise<Transaction> {
    const {
      onChainAccount,
      scope,
      assetId,
      amount,
      destination,
      useCache = false,
    } = params;

    let destinationAccount: OnChainAccount | null = null;
    if (onChainAccount.accountId === destination) {
      destinationAccount = onChainAccount;
    } else {
      destinationAccount = await this.#loadActivatedAccountOrNull(
        destination,
        scope,
        useCache,
      );
    }

    const isSep41 = isSep41Id(assetId);

    // If it is SEP-41, run SEP-41 transfer flow to build and validate the transaction
    if (isSep41) {
      // fail early if the destination account is not activated
      if (destinationAccount === null) {
        throw new AccountNotActivatedException(destination, scope);
      }

      return this.#createValidatedSep41Transfer({
        onChainAccount,
        scope,
        assetId,
        amount,
        destination,
        destinationAccount,
        useCache,
      });
    }

    // If it is classic asset, run classic asset transfer flow to build and validate the transaction
    return this.#createValidatedClassicAssetTransfer({
      onChainAccount,
      scope,
      assetId,
      amount,
      destination,
      destinationAccount,
    });
  }

  /**
   * Creates a validated SEP-41 transfer transaction (Soroban contract transfer).
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 SEP-41 asset ID.
   * @param params.amount - The amount to send.
   * @param params.destination - The destination address.
   * @param params.destinationAccount - The destination account.
   * @param params.useCache - When `true`, reuses a cached SEP-41 simulation keyed by
   * asset, sender, recipient, and scope (not amount). Use only for preflight checks
   * such as amount-input validation, where the caller needs fee/balance feedback on
   * every keystroke without an RPC call per amount. Balance is checked locally before
   * simulation, so insufficient funds still fail fast. When `false` (default), always
   * simulates fresh so the returned transaction is safe to sign and submit.
   * @returns A promise that resolves to the validated transaction.
   */
  async #createValidatedSep41Transfer(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19Sep41AssetId;
    amount: BigNumber;
    destination: string;
    destinationAccount: OnChainAccount;
    useCache: boolean;
  }): Promise<Transaction> {
    const {
      onChainAccount,
      scope,
      assetId,
      amount,
      destination,
      destinationAccount,
      useCache,
    } = params;

    let transaction = this.#transactionBuilder.sep41Transfer({
      onChainAccount,
      scope,
      assetId,
      amount,
      destination,
    });

    // Use getRawAsset so we only fetch when the asset is absent from the State.
    // Use getAsset hides zero-balance SEP-41 entries and would trigger a redundant on-chain fetch.
    if (!onChainAccount.getRawAsset(assetId)) {
      const onChainBalance = await this.#networkService.getSep41AssetBalances({
        accounts: [onChainAccount.accountId],
        assetIds: [assetId],
        scope,
      });
      onChainAccount.setAsset(assetId, {
        balance:
          onChainBalance?.[onChainAccount.accountId]?.[assetId] ??
          new BigNumber(0),
        // We don't need symbol/decimals for a SEP-41 asset here; simulation
        // does not use them.
        symbol: '',
      });
    }

    // Simulation will throw an error if the balance is less than the sending amount,
    // so we can fail early here.
    if (onChainAccount.getRawAsset(assetId)?.balance.lt(amount)) {
      throw new InsufficientBalanceException(
        onChainAccount.getRawAsset(assetId)?.balance.toString() ?? '0',
        amount.toString(),
        assetId,
      );
    }

    // Simulate the transaction to estimate the network fee for contract call
    transaction = await this.#networkService.simulateSep41TransferWithCache({
      transaction,
      scope,
      assetId,
      fromAccountId: onChainAccount.accountId,
      toAccountId: destination,
      // With useCache=true the cached XDR may carry a stale amount or sequence;
      // Callers must only use that path for preflight (e.g. onAmountInput), not signing.
      refreshCache: !useCache,
    });

    this.validateTransaction(transaction, onChainAccount, {
      expectedOPTypes: [SupportedOperations.InvokeHostFunction],
      preloadedAccounts: destinationAccount ? [destinationAccount] : undefined,
    });

    return transaction;
  }

  /**
   * Creates a validated classic asset transfer transaction.
   * Classic assets use the chain's native transfer mechanism.
   * If the destination is not activated, a `createAccount` operation can only
   * be added for slip44/native asset transfers. For non-slip44 classic assets,
   * the destination account must already be activated or an
   * `AccountNotActivatedException` will be thrown.
   * If the destination is activated, a payment operation will be added to the
   * transaction.
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.assetId - The CAIP-19 classic asset ID.
   * @param params.amount - The amount to send.
   * @param params.destination - The destination address.
   * @param params.destinationAccount - The destination account.
   * @returns A promise that resolves to the validated transaction.
   */
  async #createValidatedClassicAssetTransfer(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    assetId: KnownCaip19ClassicAssetId | KnownCaip19Slip44Id;
    amount: BigNumber;
    destination: string;
    destinationAccount: OnChainAccount | null;
  }): Promise<Transaction> {
    const {
      onChainAccount,
      scope,
      assetId,
      amount,
      destinationAccount,
      destination,
    } = params;

    const isDestinationActivated = destinationAccount !== null;

    // fail early if the destination account is not activated and the asset is not slip44
    if (!isDestinationActivated && !isSlip44Id(assetId)) {
      throw new AccountNotActivatedException(destination, scope);
    }

    const baseFee = await this.getBaseFee(scope);

    const transaction = this.#transactionBuilder.transfer({
      onChainAccount,
      scope,
      assetId,
      amount,
      destination: {
        address: destination,
        isActivated: isDestinationActivated,
      },
      baseFee,
    });

    this.validateTransaction(transaction, onChainAccount, {
      expectedOPTypes: isDestinationActivated
        ? [SupportedOperations.Payment]
        : [SupportedOperations.CreateAccount],
      preloadedAccounts: destinationAccount ? [destinationAccount] : undefined,
    });

    return transaction;
  }

  /**
   * Creates a validated swap transaction from a Base64 encoded XDR.
   *
   * @param params - The parameters for the transaction.
   * @param params.onChainAccount - The on-chain account.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.xdr - The Base64 encoded XDR of the transaction.
   * @returns A promise that resolves to the validated transaction.
   */
  async createValidatedSwapTransaction(params: {
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    xdr: string;
  }): Promise<Transaction> {
    const { onChainAccount, scope, xdr } = params;

    const transaction = Transaction.fromXdr({
      xdr,
      scope,
    });

    const transactionWithFee = await this.computingFee(transaction);

    const preloadedAccounts = await this.#getPreloadedAccounts(
      transactionWithFee,
      onChainAccount,
    );

    this.validateTransaction(transactionWithFee, onChainAccount, {
      expectedOPTypes: [
        SupportedOperations.Payment,
        SupportedOperations.PathPayment,
        SupportedOperations.InvokeHostFunction,
        SupportedOperations.ChangeTrust,
      ],
      preloadedAccounts,
    });

    return transactionWithFee;
  }

  async #getPreloadedAccounts(
    transaction: Transaction,
    onChainAccount: OnChainAccount,
  ): Promise<OnChainAccount[]> {
    // get the participating accounts Id that are not the source account,
    // as we already preloaded the source account
    const participatingAccounts: string[] = transaction.hasInvokeHostFunction
      ? []
      : transaction.participatingAccounts.filter(
          (accountId) => accountId !== onChainAccount.accountId,
        );

    const preloadedAccounts =
      await this.#networkService.loadOnChainAccountsSafe(
        participatingAccounts,
        transaction.scope,
      );

    return preloadedAccounts.filter(
      (account): account is OnChainAccount => account !== null,
    );
  }

  async #loadActivatedAccountOrNull(
    accountAddress: string,
    scope: KnownCaip2ChainId,
    useCache: boolean = false,
  ): Promise<OnChainAccount | null> {
    try {
      return await this.#networkService.loadOnChainAccountWithCache(
        accountAddress,
        scope,
        !useCache,
      );
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create and save a pending keyring transaction.
   *
   * @param request - The request {@link KeyringTransactionRequest} to create the pending transaction for.
   * @returns A promise that resolves to the pending transaction.
   */
  async savePendingKeyringTransaction(
    request: KeyringTransactionRequest,
  ): Promise<KeyringTransaction> {
    const transaction =
      this.#keyringTransactionBuilder.createTransaction(request);

    this.#logger.debug('Creating pending transaction', {
      transaction,
    });

    await this.save(transaction);

    return transaction;
  }

  /**
   * Saves a pending keyring transaction without failing the caller when persistence errors.
   *
   * @param request - Pending transaction payload to persist.
   * @returns The saved keyring transaction, or `null` when persistence fails.
   */
  async savePendingKeyringTransactionSafe(
    request: KeyringTransactionRequest,
  ): Promise<KeyringTransaction | null> {
    try {
      return await this.savePendingKeyringTransaction(request);
    } catch (error: unknown) {
      await trackError(error);

      this.#logger.warn('Failed to save pending transaction', { error });
      return null;
    }
  }

  /**
   * Computes the fee for a transaction.
   *
   * @param transaction - The transaction to compute the fee for.
   * @returns A promise that resolves to the transaction with the computed fee.
   */
  async computingFee(transaction: Transaction): Promise<Transaction> {
    if (transaction.hasInvokeHostFunction) {
      const simulatedTransaction =
        await this.#networkService.simulateTransaction(
          transaction,
          transaction.scope,
        );
      return simulatedTransaction;
    }
    return transaction;
  }

  /**
   * Runs local fee/balance/operation simulation for a transaction against the given ledger snapshot.
   * Delegates to {@link TransactionSimulator.simulate}; throws the same validation exceptions.
   *
   * @param transaction - The transaction to validate.
   * @param onChainAccount - The on-chain account to validate against.
   * @param options - Optional options for the transaction validation {@link TransactionSimulatorOptions}.
   * @throws {TransactionScopeNotMatchException} When {@link OnChainAccount.scope} does not match {@link Transaction.scope}.
   * @throws {TransactionExpireException} When the transaction time bound has passed.
   * @throws {TransactionValidationException} When the transaction cannot be validated.
   */
  validateTransaction(
    transaction: Transaction,
    onChainAccount: OnChainAccount,
    options?: TransactionSimulatorOptions,
  ): void {
    const simulator = new TransactionSimulator();
    simulator.simulate(transaction, onChainAccount, options);
  }

  /**
   * Submits a signed transaction.
   * When the transaction fails with `txBadSeq`, reloads the account sequence, rebuilds, re-signs once, and retries
   * **only when** the transaction source matches the resolved {@link OnChainAccount}'s `accountId` (this account consumes sequence)
   * **and** the envelope is **not** a Soroban `invokeHostFunction` transaction. Soroban envelopes carry `sorobanData` that a
   * sequence-only rebuild does not preserve; on `txBadSeq` for those txs this method logs, rethrows, and the caller must
   * re-simulate / re-assemble (for example after a fresh quote).
   * If the source is another account, `txBadSeq` is rethrown: sequence must be fixed on their side and the envelope re-signed.
   *
   * @param params - Options object.
   * @param params.wallet - Wallet used to sign; for automatic retry, must be the transaction source account.
   * @param params.onChainAccount - On-chain account for the signing account (sequence bump on `txBadSeq` retry).
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.transaction - The signed transaction (same envelope used as the rebuild template on retry).
   * @param params.pollTransaction - If true, wait for RPC terminal status after submit.
   * @returns A promise that resolves to the transaction hash.
   * @throws {TransactionScopeNotMatchException} When `scope` does not match {@link Transaction.scope} (from {@link assertTransactionScope} before submit).
   * @throws {TransactionRetryableException} When RPC returns `txBadSeq` (one rebuild+retry for classic txs when the tx source matches `onChainAccount`; Soroban invoke txs are not auto-retried).
   * @throws {TransactionSendException} When submission fails for other RPC reasons.
   * @throws {TransactionPollException} When `pollTransaction` is true and polling does not end in SUCCESS.
   */
  async sendTransaction(params: {
    wallet: Wallet;
    onChainAccount: OnChainAccount;
    scope: KnownCaip2ChainId;
    transaction: Transaction;
    pollTransaction?: boolean;
  }): Promise<string> {
    const {
      wallet,
      onChainAccount,
      scope,
      transaction: templateTransaction,
    } = params;

    assertTransactionScope(templateTransaction, scope);

    const pollTransaction = params.pollTransaction ?? false;

    const sendOnce = async (transaction: Transaction): Promise<string> =>
      this.#networkService.send({
        transaction,
        scope,
        pollTransaction,
      });

    try {
      return await sendOnce(templateTransaction);
    } catch (error: unknown) {
      if (error instanceof TransactionRetryableException) {
        const txSource = templateTransaction.sourceAccount;
        if (txSource !== onChainAccount.accountId) {
          this.#logger.warn(
            'transaction failed with txBadSeq but transaction source does not match wallet; cannot bump sequence.',
          );
          throw error;
        }

        const freshAccount = await this.#networkService.getAccount(
          onChainAccount.accountId,
          scope,
        );

        const newTransaction = this.#transactionBuilder.rebuildTxnWithNewSeq({
          transaction: templateTransaction,
          sequenceNumber: freshAccount.sequenceNumber,
        });

        wallet.signTransaction(newTransaction);

        return await sendOnce(newTransaction);
      }
      throw error;
    }
  }

  /**
   * Finds all pending transactions for the given account ID from snap state.
   *
   * @param accountId - The account ID to find transactions for.
   * @returns A promise that resolves to an array of transactions.
   */
  async findByAccountId(accountId: string): Promise<KeyringTransaction[]> {
    return this.#transactionRepository.findByAccountId(accountId);
  }

  /**
   * Saves a transaction.
   *
   * @param transaction - The transaction to save.
   * @returns A promise that resolves when the transaction is saved.
   */
  async save(transaction: KeyringTransaction): Promise<void> {
    // use saveMany here to leverage the state lock,
    // hence the update of the state and the transaction event emission will be in sequence
    await this.saveMany([transaction]);
  }

  /**
   * Reconciles transactions into snap state and emits all of them to the MetaMask
   * controller. Confirmed/failed removal from snap state is handled by
   * {@link TransactionRepository.saveMany}.
   *
   * @param transactions - Transactions to persist or remove locally and emit upstream.
   * @returns A promise that resolves when persistence and emission complete.
   */
  async saveMany(transactions: KeyringTransaction[]): Promise<void> {
    if (transactions.length > 0) {
      await this.#transactionRepository.saveMany(transactions);
      await this.#emitAccountTransactionsUpdated(transactions);
    }
  }

  /**
   * Pulls transaction history from the network and reconciles local snap state.
   * Delegates to {@link TransactionSynchronizeService}; intended for use from
   * {@link SynchronizeService.synchronize}.
   *
   * @param activatedAccountPairs - Activated keyring/on-chain account pairs whose history will be synced.
   * @param scope - Network scope for Horizon fetches.
   * @param sep41Assets - Preloaded SEP-41 assets from {@link SynchronizeService}.
   */
  async synchronize(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
    sep41Assets: StellarAssetMetadata[],
  ): Promise<void> {
    await this.#transactionSynchronizeService.synchronize(
      activatedAccountPairs,
      scope,
      sep41Assets,
    );
  }

  async #emitAccountTransactionsUpdated(
    transactions: KeyringTransaction[],
  ): Promise<void> {
    const transactionsByAccountId = groupBy(transactions, 'account');

    await emitSnapKeyringEvent(
      getSnapProvider(),
      KeyringEvent.AccountTransactionsUpdated,
      {
        transactions: transactionsByAccountId,
      },
    );
  }
}
