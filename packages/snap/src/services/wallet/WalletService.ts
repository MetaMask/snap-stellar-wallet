import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';

import type { IDeriver } from './api';
import {
  AccountNotActivatedException,
  WalletServiceException,
} from './exceptions';
import type { NetworkService } from './NetworkService';
import type { Transaction } from './Transaction';
import type { TransactionBuilder } from './TransactionBuilder';
import { Wallet } from './Wallet';
import type { KnownCaip2ChainId } from '../../api';
import { createPrefixedLogger } from '../../utils';
import type { ILogger } from '../../utils';

/**
 * Orchestrates wallet operations: address derivation, activated account resolution,
 * activation checks, and transaction signing. Delegates network I/O to {@link NetworkService}
 * and transaction building to {@link TransactionBuilder}.
 */
export class WalletService {
  readonly #logger: ILogger;

  readonly #deriver: IDeriver;

  readonly #networkService: NetworkService;

  readonly #transactionBuilder: TransactionBuilder;

  constructor({
    logger,
    deriver,
    networkService,
    transactionBuilder,
  }: {
    logger: ILogger;
    deriver: IDeriver;
    networkService: NetworkService;
    transactionBuilder: TransactionBuilder;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💼 WalletService]');

    this.#deriver = deriver;
    this.#networkService = networkService;
    this.#transactionBuilder = transactionBuilder;
  }

  /**
   * The transaction builder for creating and rebuilding Stellar transactions.
   *
   * @returns The {@link TransactionBuilder} instance.
   */
  get builder(): TransactionBuilder {
    return this.#transactionBuilder;
  }

  /**
   * The network service for fees, account loading, and transaction submission.
   *
   * @returns The {@link NetworkService} instance.
   */
  get network(): NetworkService {
    return this.#networkService;
  }

  /**
   * Derives a Stellar address (public key) from the given entropy source and derivation index.
   *
   * @param params - Options object.
   * @param params.index - The derivation index for the account.
   * @param params.entropySource - Entropy source ID (e.g. from keyring).
   * @returns A Promise that resolves to the derived address (public key string).
   * @throws {WalletServiceException} If keypair derivation fails.
   */
  async deriveAddress(params: {
    index: number;
    entropySource: string;
  }): Promise<string> {
    const { index, entropySource } = params;
    const keypair = await this.#deriveKeypair({ index, entropySource });
    return keypair.publicKey();
  }

  /**
   * Loads an activated Stellar account (funded on the network) and returns a {@link Wallet} handle.
   *
   * @param params - Options object.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.entropySource - The entropy source ID.
   * @param params.index - The derivation index.
   * @returns A Promise that resolves to a wallet with loaded account and signer.
   * @throws {AccountNotActivatedException} If the account does not exist or is not funded on the network.
   * @throws {WalletServiceException} If keypair derivation fails.
   */
  async resolveActivatedAccount(params: {
    scope: KnownCaip2ChainId;
    entropySource: string;
    index: number;
  }): Promise<Wallet> {
    const { scope, entropySource, index } = params;
    const keypair = await this.#deriveKeypair({
      index,
      entropySource,
    });

    const loadedAccount = await this.#networkService.loadAccount(
      keypair.publicKey(),
      scope,
    );

    return new Wallet(loadedAccount, keypair);
  }

  /**
   * Returns whether the given address has an activated account on the network.
   *
   * @param params - Options object.
   * @param params.address - The Stellar account address (public key).
   * @param params.scope - The CAIP-2 chain ID.
   * @returns A Promise that resolves to `true` if the account exists and is funded, `false` if not found. Rethrows other errors (e.g. {@link AccountLoadException}).
   */
  async isAccountActivated(params: {
    address: string;
    scope: KnownCaip2ChainId;
  }): Promise<boolean> {
    const { address, scope } = params;
    try {
      await this.#networkService.loadAccount(address, scope);
      return true;
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Signs a transaction with the wallet's signer. Uses the current network sequence for the source account.
   *
   * @param params - Options object.
   * @param params.account - The wallet to sign the transaction with.
   * @param params.scope - The CAIP-2 chain ID.
   * @param params.baseFee - [optional] The base fee to use for the transaction; if omitted, fetched from the network.
   * @param params.transaction - The transaction to sign.
   * @returns A Promise that resolves when the transaction has been signed.
   * @throws {AccountNotActivatedException} If the account is not found on the network.
   * @throws {AccountLoadException} If loading the account fails for another reason.
   * @throws {WalletServiceException} If signing fails.
   */
  async signTransaction(params: {
    account: Wallet;
    scope: KnownCaip2ChainId;
    baseFee?: BigNumber;
    transaction: Transaction;
  }): Promise<void> {
    const { account, scope, baseFee, transaction } = params;

    let baseFeeToUse = baseFee;
    baseFeeToUse ??= await this.#networkService.getBaseFee(scope);

    // Load fresh account for latest sequence number
    const freshAccount = await this.#networkService.loadAccount(
      account.account.accountId(),
      scope,
    );

    const txToSign = this.builder.rebuildTransaction({
      transaction,
      account: freshAccount,
      baseFee: baseFeeToUse.toString(),
    });

    try {
      account.signTransaction(txToSign);
    } catch (error) {
      this.#logger.logErrorWithDetails('Error signing transaction', error);
      throw new WalletServiceException('Failed to sign transaction');
    }
  }

  async #deriveKeypair({
    index,
    entropySource,
  }: {
    index: number;
    entropySource: string;
  }): Promise<StellarKeypair> {
    try {
      const seed = await this.#deriver.get32ByteSeed(index, entropySource);
      return StellarKeypair.fromRawEd25519Seed(seed as Buffer);
    } catch (error: unknown) {
      this.#logger.logErrorWithDetails('Error deriving keypair', error);
      throw new WalletServiceException('Failed to derive keypair');
    }
  }
}
