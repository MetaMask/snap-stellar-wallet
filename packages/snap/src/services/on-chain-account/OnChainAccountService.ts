import { OnChainAccount } from './OnChainAccount';
import { OnChainAccountSynchronizeService } from './OnChainAccountSynchronizeService';
import type { KnownCaip2ChainId } from '../../api';
import type { ILogger } from '../../utils';
import type { StellarKeyringAccount } from '../account';
import { assertSameAddress } from '../account/utils';
import { type NetworkService } from '../network';
import type { OnChainAccountRepository } from './OnChainAccountRepository';
import type { AssetMetadataService } from '../asset-metadata/AssetMetadataService';

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
    assetMetadataService,
    logger,
  }: {
    networkService: NetworkService;
    onChainAccountRepository: OnChainAccountRepository;
    assetMetadataService: AssetMetadataService;
    logger: ILogger;
  }) {
    this.#networkService = networkService;
    this.#onChainAccountSynchronizeService =
      new OnChainAccountSynchronizeService({
        networkService,
        onChainAccountRepository,
        assetMetadataService,
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
    return (
      (await this.#networkService.getAccountOrNull(accountAddress, scope)) !==
      null
    );
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
  async resolveOnChainAccountByAccountId(
    keyringAccountId: string,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount | null> {
    const onChainAccount = await this.#onChainAccountRepository.findByAccountId(
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
   * @param keyringAccount - Stellar keyring accounts to sync for `scope`.
   * @param scope - CAIP-2 network.
   */
  async synchronize(
    keyringAccount: StellarKeyringAccount[],
    scope: KnownCaip2ChainId,
  ): Promise<void> {
    await this.#onChainAccountSynchronizeService.synchronize(
      keyringAccount,
      scope,
    );
  }
}
