import { OnChainAccount } from './OnChainAccount';
import { OnChainAccountSynchronizeService } from './OnChainAccountSynchronizeService';
import type { KnownCaip2ChainId } from '../../api';
import type { ILogger } from '../../utils';
import { assertSameAddress } from '../account/utils';
import { AccountNotActivatedException, type NetworkService } from '../network';
import type { OnChainAccountRepository } from './OnChainAccountRepository';
import type { StellarAssetMetadata } from '../asset-metadata';
import type { ActivatedAccountPair } from '../sync/api';

/**
 * Stellar on-chain account operations: activation checks and loading {@link OnChainAccount}
 * via {@link NetworkService}.
 */
export class OnChainAccountService {
  readonly #networkService: NetworkService;

  readonly #onChainAccountSynchronizeService: OnChainAccountSynchronizeService;

  readonly #onChainAccountRepository: OnChainAccountRepository;

  constructor({
    networkService,
    onChainAccountRepository,
    logger,
  }: {
    networkService: NetworkService;
    onChainAccountRepository: OnChainAccountRepository;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#onChainAccountSynchronizeService =
      new OnChainAccountSynchronizeService({
        networkService,
        onChainAccountRepository,
        logger,
      });
    this.#onChainAccountRepository = onChainAccountRepository;
  }

  /**
   * Returns whether the given address has a funded account on the network.
   *
   * @param params - Options object.
   * @param params.accountAddress - The Stellar account address (public key).
   * @param params.scope - The CAIP-2 chain ID.
   * @returns `true` if the account exists and is funded, `false` if missing.
   */
  async isAccountActivated(params: {
    accountAddress: string;
    scope: KnownCaip2ChainId;
  }): Promise<boolean> {
    const { accountAddress, scope } = params;
    try {
      await this.#networkService.getAccount(accountAddress, scope);
      return true;
    } catch (error: unknown) {
      if (error instanceof AccountNotActivatedException) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Loads activated on-chain state for an address on the given network and verifies the loaded
   * account id matches that address.
   *
   * @param accountAddress - Stellar address (strkey) expected to match Horizon `account_id`.
   * @param scope - CAIP-2 network to load the account from (Horizon `loadAccount`).
   * @returns Loaded {@link OnChainAccount} for simulation, fees, and sequence.
   * @throws {AccountNotActivatedException} When the account is not funded (from {@link NetworkService.loadOnChainAccount}).
   * @throws {DerivedAccountAddressMismatchException} When loaded id does not match `accountAddress`.
   */
  async resolveOnChainAccount(
    accountAddress: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount> {
    const loaded = await this.#networkService.loadOnChainAccount(
      accountAddress,
      scope,
    );
    assertSameAddress(accountAddress, loaded.accountId);
    return loaded;
  }

  /**
   * Loads the on-chain account for the given keyring account id from the State.
   *
   * @param keyringAccountId - The keyring account id to load the on-chain account for.
   * @param scope - The CAIP-2 chain id to load the on-chain account for.
   * @returns The on-chain account, or `null` if not found.
   */
  async resolveOnChainAccountByKeyringAccountId(
    keyringAccountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount | null> {
    const onChainAccount =
      await this.#onChainAccountRepository.findByKeyringAccountId(
        keyringAccountId,
        scope,
      );
    return onChainAccount
      ? OnChainAccount.fromSerializable(onChainAccount)
      : null;
  }

  /**
   * Enriches accounts with SEP-41 balances, persists snapshots, then notifies the keyring when
   * balances or the tracked asset set changed. Delegates to {@link OnChainAccountSynchronizeService}.
   *
   * @param activatedAccountPairs - Activated account pairs to synchronize.
   * @param scope - CAIP-2 network.
   * @param sep41Assets - Preloaded SEP-41 assets from {@link SynchronizeService}.
   */
  async synchronize(
    activatedAccountPairs: ActivatedAccountPair[],
    scope: KnownCaip2ChainId,
    sep41Assets: StellarAssetMetadata[],
  ): Promise<void> {
    await this.#onChainAccountSynchronizeService.synchronize(
      activatedAccountPairs,
      scope,
      sep41Assets,
    );
  }
}
