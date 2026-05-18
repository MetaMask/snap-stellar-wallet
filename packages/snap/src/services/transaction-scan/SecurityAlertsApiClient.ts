/* eslint-disable @typescript-eslint/naming-convention */
import { assert } from '@metamask/superstruct';

import {
  StellarTransactionScanResponseStruct,
  type SecurityAlertsMetadata,
  type StellarTransactionScanRequest,
  type StellarTransactionScanResponse,
  type TransactionScanOption,
} from './api';
import { TransactionScanException } from './exceptions';
import { KnownCaip2ChainId, UrlStruct } from '../../api';
import type { ILogger } from '../../utils';
import {
  buildUrl,
  createPrefixedLogger,
  logger,
  rethrowIfInstanceElseThrow,
} from '../../utils';

const SCOPE_TO_SECURITY_ALERTS_CHAIN: Record<
  KnownCaip2ChainId,
  StellarTransactionScanRequest['chain']
> = {
  [KnownCaip2ChainId.Mainnet]: 'pubnet',
  [KnownCaip2ChainId.Testnet]: 'testnet',
};

export class SecurityAlertsApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #logger: ILogger;

  readonly #baseUrl: string;

  constructor(
    { baseUrl }: { baseUrl: string },
    _logger: ILogger = logger,
    _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    assert(baseUrl, UrlStruct);

    this.#fetch = _fetch;
    this.#logger = createPrefixedLogger(
      _logger,
      '[🛡️ SecurityAlertsApiClient]',
    );
    this.#baseUrl = baseUrl;
  }

  async scanTransaction({
    accountAddress,
    origin,
    scope,
    transaction,
    options,
  }: {
    accountAddress: string;
    origin: string;
    scope: KnownCaip2ChainId;
    transaction: string;
    options: TransactionScanOption[];
  }): Promise<StellarTransactionScanResponse> {
    try {
      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/stellar/transaction/scan',
      });

      const requestBody: StellarTransactionScanRequest = {
        account_address: accountAddress,
        chain: SCOPE_TO_SECURITY_ALERTS_CHAIN[scope],
        metadata: this.#getMetadata(origin),
        transaction,
        options,
      };

      const response = await this.#fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new TransactionScanException(
          `HTTP error! status: ${response.status}`,
        );
      }

      const data = await response.json();
      assert(data, StellarTransactionScanResponseStruct);

      return data;
    } catch (error) {
      this.#logger.logErrorWithDetails(
        'Error scanning Stellar transaction',
        error,
      );
      return rethrowIfInstanceElseThrow(
        error,
        [TransactionScanException],
        new TransactionScanException('Error scanning Stellar transaction'),
      );
    }
  }

  #getMetadata(origin: string): SecurityAlertsMetadata {
    try {
      const url = new URL(origin);
      return {
        type: 'wallet',
        url: url.origin,
      };
    } catch {
      return {
        type: 'in_app',
      };
    }
  }
}
