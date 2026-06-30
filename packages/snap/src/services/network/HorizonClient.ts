/* eslint-disable @typescript-eslint/naming-convention -- Horizon wire fields use snake_case */
import type { Horizon } from '@stellar/stellar-sdk';

type HorizonAccountJson = Horizon.AccountResponse & {
  account_id?: string;
  id?: string;
  sequence?: string;
};

type HorizonCollectionResponse<TRecord> = {
  records?: TRecord[];
  _embedded?: { records?: TRecord[] };
  _links?: {
    next?: {
      href?: string;
    };
  };
};

export type HorizonAssetRecord = {
  asset_code?: string;
  asset_issuer?: string;
};

export type HorizonAssetRecordsResponse = {
  records: HorizonAssetRecord[];
};

export type HorizonTransactionPage = {
  records: Horizon.ServerApi.TransactionRecord[];
  next: () => Promise<HorizonTransactionPage>;
};

/**
 * Error thrown when Horizon returns HTTP 404.
 */
export class HorizonNotFoundError extends Error {
  readonly status = 404;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HorizonNotFoundError';
  }
}

/**
 * Small Snap-safe Horizon client using the platform `fetch` endowment directly.
 */
export class HorizonClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/u, '');
  }

  async fetchBaseFee(): Promise<number> {
    const feeStats = await this.#requestJson<{
      last_ledger_base_fee?: string;
    }>('/fee_stats');
    return parseInt(feeStats.last_ledger_base_fee ?? '', 10) || 100;
  }

  async loadAccount(accountAddress: string): Promise<Horizon.AccountResponse> {
    const account = await this.#requestJson<HorizonAccountJson>(
      `/accounts/${encodeURIComponent(accountAddress)}`,
    );
    return this.#toAccountResponse(account);
  }

  async getAssetRecords(params: {
    assetCode: string;
    assetIssuer: string;
  }): Promise<HorizonAssetRecordsResponse> {
    const { assetCode, assetIssuer } = params;
    const response = await this.#requestJson<
      HorizonCollectionResponse<HorizonAssetRecord>
    >(
      `/assets?${encodeQuery({
        asset_code: assetCode,
        asset_issuer: assetIssuer,
      })}`,
    );

    return {
      records: response.records ?? response._embedded?.records ?? [],
    };
  }

  async getTransaction(
    transactionHash: string,
  ): Promise<Horizon.ServerApi.TransactionRecord> {
    return this.#requestJson(
      `/transactions/${encodeURIComponent(transactionHash)}`,
    );
  }

  async getTransactions(params: {
    accountAddress: string;
    cursor: string;
    includeFailed: boolean;
    limit: number;
    order: 'asc' | 'desc';
  }): Promise<HorizonTransactionPage> {
    const { accountAddress, cursor, includeFailed, limit, order } = params;
    return this.#getTransactionPage(
      `/accounts/${encodeURIComponent(accountAddress)}/transactions?${encodeQuery(
        {
          cursor,
          include_failed: includeFailed,
          limit,
          order,
        },
      )}`,
    );
  }

  async #getTransactionPage(url: string): Promise<HorizonTransactionPage> {
    const response =
      await this.#requestJson<
        HorizonCollectionResponse<Horizon.ServerApi.TransactionRecord>
      >(url);
    const nextUrl = response._links?.next?.href;

    const records = response.records ?? response._embedded?.records ?? [];

    return {
      records,
      next: async (): Promise<HorizonTransactionPage> => {
        if (nextUrl === undefined || nextUrl.length === 0) {
          return emptyTransactionPage();
        }
        return this.#getTransactionPage(nextUrl);
      },
    };
  }

  #toAccountResponse(account: HorizonAccountJson): Horizon.AccountResponse {
    const accountId = account.account_id ?? account.id;
    const { sequence } = account;

    return Object.assign(account, {
      accountId(): string | undefined {
        return accountId;
      },
      sequenceNumber(): string | undefined {
        return sequence;
      },
    }) as Horizon.AccountResponse;
  }

  async #requestJson<TResponse>(pathOrUrl: string): Promise<TResponse> {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.#baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    const body = await response.text();
    const data = parseJsonBody(body);

    if (response.status === 404) {
      throw new HorizonNotFoundError(`Horizon resource not found: ${url}`, {
        cause: data,
      });
    }

    if (!response.ok) {
      throw new Error(`Horizon request failed with status ${response.status}`, {
        cause: data,
      });
    }

    return data as TResponse;
  }
}

/**
 * Encodes query parameters without relying on URLSearchParams, which is not guaranteed in SES.
 *
 * @param params - Query parameters.
 * @returns Encoded query string.
 */
function encodeQuery(
  params: Record<string, boolean | number | string | undefined>,
): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');
}

/**
 * Parses a JSON response body.
 *
 * @param body - Response text.
 * @returns Parsed JSON, or null for empty responses.
 */
function parseJsonBody(body: string): unknown {
  if (body.length === 0) {
    return null;
  }
  return JSON.parse(body);
}

/**
 * Builds an empty Horizon transaction page.
 *
 * @returns Empty transaction page.
 */
function emptyTransactionPage(): HorizonTransactionPage {
  return {
    records: [],
    next: async () => emptyTransactionPage(),
  };
}
