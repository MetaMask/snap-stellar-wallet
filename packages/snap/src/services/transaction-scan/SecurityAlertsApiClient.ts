/* eslint-disable @typescript-eslint/naming-convention */
import { assert } from '@metamask/superstruct';

import {
  StellarTransactionScanResponseStruct,
  ScanTransactionRequestStruct,
} from './api';
import type {
  ScanTransactionRequest,
  SecurityAlertsMetadata,
  SecurityAlertsApiRequest,
  StellarTransactionScanResponse,
} from './api';
import { TransactionScanException } from './exceptions';
import { KnownCaip2ChainId, UrlStruct } from '../../api';
import type { AnyErrorConstructor } from '../../utils';
import { buildUrl, rethrowIfInstanceElseThrow } from '../../utils';
import {
  assertHttpRequestParams,
  assertHttpResponse,
  HttpException,
  HttpResponseException,
  InvalidHttpRequestParamsException,
  InvalidHttpResponseException,
  normalizeHttpException,
} from '../../utils/errors';

const SCOPE_TO_SECURITY_ALERTS_CHAIN: Record<
  KnownCaip2ChainId,
  SecurityAlertsApiRequest['chain']
> = {
  [KnownCaip2ChainId.Mainnet]: 'pubnet',
  [KnownCaip2ChainId.Testnet]: 'testnet',
};

export class SecurityAlertsApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #baseUrl: string;

  constructor(
    { baseUrl }: { baseUrl: string },
    _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    assert(baseUrl, UrlStruct);

    this.#fetch = _fetch;
    this.#baseUrl = baseUrl;
  }

  async scanTransaction({
    accountAddress,
    origin,
    scope,
    transaction,
    options,
  }: ScanTransactionRequest): Promise<StellarTransactionScanResponse> {
    try {
      assertHttpRequestParams(
        {
          accountAddress,
          origin,
          scope,
          transaction,
          options,
        },
        ScanTransactionRequestStruct,
      );

      const url = buildUrl({
        baseUrl: this.#baseUrl,
        path: '/stellar/transaction/scan',
      });

      const requestBody: SecurityAlertsApiRequest = {
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
        throw new HttpResponseException(response.status);
      }

      const data = await response.json();

      assertHttpResponse(data, StellarTransactionScanResponseStruct);

      return data;
    } catch (error: unknown) {
      return this.#throwError({
        error,
        fallbackError: 'Error scanning Stellar transaction',
      });
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

  #throwError({
    error,
    exceptionClasses,
    fallbackError,
  }: {
    error: unknown;
    exceptionClasses?: readonly AnyErrorConstructor[];
    fallbackError: string | TransactionScanException;
  }): never {
    const normalized = normalizeHttpException(error);

    if (normalized instanceof HttpException) {
      throw normalized;
    }

    return rethrowIfInstanceElseThrow(
      normalized,
      [
        TransactionScanException,
        InvalidHttpRequestParamsException,
        InvalidHttpResponseException,
        ...(exceptionClasses ?? []),
      ],
      fallbackError instanceof Error
        ? fallbackError
        : new TransactionScanException(String(fallbackError), { cause: error }),
    );
  }
}
