import type { EntropySourceId } from '@metamask/keyring-api';

import type { KnownCaip2ChainId } from '../../api';
import type { AccountService, StellarKeyringAccount } from '../account';
import type { OnChainAccount } from './OnChainAccount';
import { assertSameAddress } from '../account/utils';
import type { NetworkService } from '../network';

/**
 * Stellar on-chain account operations: activation checks, loading {@link OnChainAccount},
 * and persisting {@link OnChainAccountSnapshot} records for sync.
 *
 * Signing keypairs are derived by {@link WalletService}; this service does not depend on it.
 */
export class OnChainAccountService {
  readonly #networkService: NetworkService;

  readonly #accountService: AccountService;

  constructor({
    networkService,
    accountService,
  }: {
    networkService: NetworkService;
    accountService: AccountService;
  }) {
    this.#networkService = networkService;
    this.#accountService = accountService;
  }

  /**
   * Derives a keyring-shaped account and returns it when that address is activated on Stellar.
   *
   * @param options - Discovery inputs.
   * @param options.entropySource - Entropy source used to derive the address.
   * @param options.index - Derivation index.
   * @param options.scope - CAIP-2 network to check activation on.
   * @returns The derived keyring-shaped account if funded on-chain, otherwise `null`.
   */
  async discoverOnChainAccount({
    entropySource,
    index,
    scope,
  }: {
    entropySource: EntropySourceId;
    index: number;
    scope: KnownCaip2ChainId;
  }): Promise<StellarKeyringAccount | null> {
    const account = await this.#accountService.deriveKeyringAccount({
      entropySource,
      index,
    });

    const isActivated = await this.isAccountActivated({
      accountAddress: account.address,
      scope,
    });

    if (!isActivated) {
      return null;
    }

    return account;
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
   * Loads activated on-chain state for a keyring row on the given network and verifies the loaded
   * account id matches the keyring address.
   *
   * @param account - Keyring account whose address must match the Horizon account id.
   * @param scope - CAIP-2 network to load the account from (Horizon `loadAccount`).
   * @returns Loaded {@link OnChainAccount} for simulation, fees, and sequence.
   * @throws {AccountNotActivatedException} When the account is not funded (from {@link NetworkService.loadOnChainAccount}).
   * @throws {DerivedAccountAddressMismatchException} When loaded id does not match `account.address`.
   */
  async resolveOnChainAccount(
    account: StellarKeyringAccount,
    scope: KnownCaip2ChainId,
  ): Promise<OnChainAccount> {
    const loaded = await this.#networkService.loadOnChainAccount(
      account.address,
      scope,
    );
    assertSameAddress(account.address, loaded.accountId);
    return loaded;
  }
}
