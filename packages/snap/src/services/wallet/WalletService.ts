import type { Account } from '@stellar/stellar-sdk';
import { Horizon as StellarHorizon, NotFoundError } from '@stellar/stellar-sdk';

import { AppConfig } from '../../config';
import type { ILogger } from '../../utils';
import { createPrefixedLogger } from '../../utils';

export class WalletService {
  readonly #logger: ILogger;

  readonly #stellarHorizonClient: StellarHorizon.Server;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[💼 WalletService]');

    // There is only one network to support for now,
    // so we can create only one instance of the Stellar Horizon client.
    this.#stellarHorizonClient = new StellarHorizon.Server(
      AppConfig.networks[AppConfig.selectedNetwork].horizonUrl,
    );
  }

  /**
   * Loads an account from the Stellar Network.
   *
   * @param accountAddress - The address of the account to load.
   * @returns The account if found, otherwise null.
   */
  async loadAccount(accountAddress: string): Promise<Account | null> {
    try {
      return await this.#stellarHorizonClient.loadAccount(accountAddress);
    } catch (error: unknown) {
      this.#logger.error('Error loading account', { error });
      // When the account is not found, the Stellar SDK throws a NotFoundError.
      // Handle this case separately and return null.
      if (error instanceof NotFoundError) {
        return null;
      }
      // Hide the error details from the user.
      throw new Error('Failed to load account from Stellar Network');
    }
  }
}
