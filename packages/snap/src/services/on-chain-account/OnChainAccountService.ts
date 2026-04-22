import type { OnChainAccount } from './OnChainAccount';
import type { KnownCaip2ChainId } from '../../api';
import { assertSameAddress } from '../account/utils';
import type { NetworkService } from '../network';

/**
 * Stellar on-chain account operations: activation checks and loading {@link OnChainAccount}
 * via {@link NetworkService}.
 */
export class OnChainAccountService {
  readonly #networkService: NetworkService;

  constructor({ networkService }: { networkService: NetworkService }) {
    this.#networkService = networkService;
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
}
