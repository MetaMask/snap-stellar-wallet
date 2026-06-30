/* eslint-disable @typescript-eslint/naming-convention -- JSON-RPC and SDK wire fields use XDR names */
import {
  Account,
  Keypair,
  rpc,
  SorobanDataBuilder,
  type FeeBumpTransaction,
  type Transaction as StellarTransaction,
  xdr,
} from '@stellar/stellar-sdk';

const JSON_RPC_VERSION = '2.0';
const REQUEST_ID = 1;
const DEFAULT_GET_TRANSACTION_TIMEOUT = 30;

type JsonRpcError = {
  code?: number;
  data?: unknown;
  message?: string;
};

type JsonRpcResponse<TResponse> = {
  error?: JsonRpcError;
  result?: TResponse;
};

class SorobanJsonRpcError extends Error {
  readonly code?: number;

  readonly data?: unknown;

  constructor(error: JsonRpcError) {
    super(error.message ?? 'Soroban RPC error');
    this.name = 'SorobanJsonRpcError';
    this.code = error.code;
    this.data = error.data;
  }
}

type RawLedgerEntryChange = {
  after: string | null;
  before: string | null;
  key: string;
  type: number;
};

type RawSimulateHostFunctionResult = {
  auth?: string[];
  xdr?: string;
};

type RawSimulateTransactionResponse = {
  error?: string;
  events?: string[];
  id: string;
  latestLedger: number;
  minResourceFee?: string;
  results?: RawSimulateHostFunctionResult[];
  restorePreamble?: {
    minResourceFee: string;
    transactionData: string;
  };
  stateChanges?: RawLedgerEntryChange[];
  transactionData?: string;
};

type RawSendTransactionResponse = rpc.Api.RawSendTransactionResponse & {
  diagnosticEventsXdr?: string[];
  errorResultXdr?: string;
};

type RawGetTransactionResponse = rpc.Api.RawGetTransactionResponse;

export type SorobanRpcPollOptions = {
  attempts?: number;
  sleepStrategy?: (attempt: number) => number;
};

/**
 * Small Snap-safe Soroban JSON-RPC client using the platform `fetch` endowment directly.
 */
export class SorobanRpcClient {
  readonly #rpcUrl: string;

  constructor(rpcUrl: string) {
    this.#rpcUrl = rpcUrl;
  }

  async getAccount(accountAddress: string): Promise<Account> {
    const ledgerKey = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({
        accountId: Keypair.fromPublicKey(accountAddress).xdrPublicKey(),
      }),
    );

    try {
      const entry = await this.#getLedgerEntry(ledgerKey);
      return new Account(
        accountAddress,
        entry.val.account().seqNum().toString(),
      );
    } catch {
      throw new Error(`Account not found: ${accountAddress}`);
    }
  }

  async getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<rpc.Api.GetLedgerEntriesResponse> {
    const result = await this.#post<rpc.Api.RawGetLedgerEntriesResponse>(
      'getLedgerEntries',
      {
        keys: keys.map((key) => key.toXDR('base64')),
      },
    );

    return parseRawLedgerEntries(result);
  }

  async pollTransaction(
    hash: string,
    opts?: SorobanRpcPollOptions,
  ): Promise<rpc.Api.GetTransactionResponse> {
    const maxAttempts =
      (opts?.attempts ?? 0) < 1
        ? DEFAULT_GET_TRANSACTION_TIMEOUT
        : (opts?.attempts ?? DEFAULT_GET_TRANSACTION_TIMEOUT);
    let foundInfo: rpc.Api.GetTransactionResponse | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      foundInfo = await this.getTransaction(hash);
      if (foundInfo.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        return foundInfo;
      }
      await sleep((opts?.sleepStrategy ?? basicSleepStrategy)(attempt));
    }

    if (foundInfo === undefined) {
      throw new Error(`Failed to poll transaction: ${hash}`);
    }
    return foundInfo;
  }

  async getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    const raw = await this.#post<RawGetTransactionResponse>('getTransaction', {
      hash,
    });

    const foundInfo =
      raw.status === rpc.Api.GetTransactionStatus.NOT_FOUND
        ? {}
        : parseRawTransactionInfo(raw);

    return {
      status: raw.status,
      txHash: hash,
      latestLedger: raw.latestLedger,
      latestLedgerCloseTime: raw.latestLedgerCloseTime,
      oldestLedger: raw.oldestLedger,
      oldestLedgerCloseTime: raw.oldestLedgerCloseTime,
      ...foundInfo,
    } as rpc.Api.GetTransactionResponse;
  }

  async sendTransaction(
    transaction: FeeBumpTransaction | StellarTransaction,
  ): Promise<rpc.Api.SendTransactionResponse> {
    const result = await this.#post<RawSendTransactionResponse>(
      'sendTransaction',
      {
        transaction: transaction.toXDR(),
      },
    );

    return parseRawSendTransaction(result);
  }

  async simulateTransaction(
    transaction: FeeBumpTransaction | StellarTransaction,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    const result = await this.#post<RawSimulateTransactionResponse>(
      'simulateTransaction',
      {
        transaction: transaction.toXDR(),
      },
    );

    return parseRawSimulation(result);
  }

  async #getLedgerEntry(
    key: xdr.LedgerKey,
  ): Promise<rpc.Api.LedgerEntryResult> {
    const results = await this.getLedgerEntries(key);
    if (results.entries.length !== 1 || results.entries[0] === undefined) {
      throw new Error(`failed to find an entry for key ${key.toXDR('base64')}`);
    }
    return results.entries[0];
  }

  async #post<TResponse>(method: string, params?: unknown): Promise<TResponse> {
    const response = await fetch(this.#rpcUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id: REQUEST_ID,
        method,
        params,
      }),
    });
    const body = await response.text();
    const json = parseJsonBody(body) as JsonRpcResponse<TResponse> | null;

    if (!response.ok) {
      throw new Error(
        `Soroban RPC request failed with status ${response.status}`,
        {
          cause: json,
        },
      );
    }

    if (json?.error !== undefined) {
      throw new SorobanJsonRpcError(json.error);
    }

    return json?.result as TResponse;
  }
}

/**
 * Parses raw ledger entry rows into SDK XDR values.
 *
 * @param raw - Raw RPC ledger entry response.
 * @returns Parsed ledger entry response.
 */
function parseRawLedgerEntries(
  raw: rpc.Api.RawGetLedgerEntriesResponse,
): rpc.Api.GetLedgerEntriesResponse {
  return {
    latestLedger: raw.latestLedger,
    entries: (raw.entries ?? []).map((entry) => {
      if (!entry.key || !entry.xdr) {
        throw new TypeError(`invalid ledger entry: ${JSON.stringify(entry)}`);
      }
      return {
        lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq,
        key: xdr.LedgerKey.fromXDR(entry.key, 'base64'),
        val: xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64'),
        ...(entry.liveUntilLedgerSeq === undefined
          ? {}
          : { liveUntilLedgerSeq: entry.liveUntilLedgerSeq }),
      };
    }),
  };
}

/**
 * Parses a raw send transaction response into SDK XDR values.
 *
 * @param raw - Raw RPC send transaction response.
 * @returns Parsed send transaction response.
 */
function parseRawSendTransaction(
  raw: RawSendTransactionResponse,
): rpc.Api.SendTransactionResponse {
  const { diagnosticEventsXdr, errorResultXdr, ...rest } = raw;
  if (errorResultXdr !== undefined && errorResultXdr.length > 0) {
    return {
      ...rest,
      ...(diagnosticEventsXdr !== undefined && diagnosticEventsXdr.length > 0
        ? {
            diagnosticEvents: diagnosticEventsXdr.map((event) =>
              xdr.DiagnosticEvent.fromXDR(event, 'base64'),
            ),
          }
        : {}),
      errorResult: xdr.TransactionResult.fromXDR(errorResultXdr, 'base64'),
    };
  }
  return { ...rest };
}

/**
 * Parses a raw simulation response into SDK XDR values.
 *
 * @param raw - Raw RPC simulation response.
 * @returns Parsed simulation response.
 */
function parseRawSimulation(
  raw: RawSimulateTransactionResponse,
): rpc.Api.SimulateTransactionResponse {
  const base = {
    _parsed: true,
    id: raw.id,
    latestLedger: raw.latestLedger,
    events:
      raw.events?.map((event) =>
        xdr.DiagnosticEvent.fromXDR(event, 'base64'),
      ) ?? [],
  };

  if (typeof raw.error === 'string') {
    return {
      ...base,
      error: raw.error,
    };
  }

  const success = {
    ...base,
    transactionData: new SorobanDataBuilder(raw.transactionData),
    minResourceFee: raw.minResourceFee ?? '0',
    ...((raw.results?.length ?? 0) > 0
      ? {
          result: raw.results?.map((row) => ({
            auth:
              row.auth?.map((entry) =>
                xdr.SorobanAuthorizationEntry.fromXDR(entry, 'base64'),
              ) ?? [],
            retval:
              row.xdr === undefined || row.xdr.length === 0
                ? xdr.ScVal.scvVoid()
                : xdr.ScVal.fromXDR(row.xdr, 'base64'),
          }))[0],
        }
      : {}),
    ...((raw.stateChanges?.length ?? 0) > 0
      ? {
          stateChanges: raw.stateChanges?.map((entryChange) => ({
            type: entryChange.type,
            key: xdr.LedgerKey.fromXDR(entryChange.key, 'base64'),
            before:
              entryChange.before === null
                ? null
                : xdr.LedgerEntry.fromXDR(entryChange.before, 'base64'),
            after:
              entryChange.after === null
                ? null
                : xdr.LedgerEntry.fromXDR(entryChange.after, 'base64'),
          })),
        }
      : {}),
  };

  if (
    raw.restorePreamble === undefined ||
    raw.restorePreamble.transactionData.length === 0
  ) {
    return success;
  }

  return {
    ...success,
    restorePreamble: {
      minResourceFee: raw.restorePreamble.minResourceFee,
      transactionData: new SorobanDataBuilder(
        raw.restorePreamble.transactionData,
      ),
    },
  } as rpc.Api.SimulateTransactionResponse;
}

/**
 * Parses raw transaction polling details into SDK XDR values.
 *
 * @param raw - Raw RPC transaction response.
 * @returns Parsed transaction details.
 */
function parseRawTransactionInfo(
  raw: RawGetTransactionResponse,
):
  | Omit<
      rpc.Api.GetFailedTransactionResponse,
      | 'latestLedger'
      | 'latestLedgerCloseTime'
      | 'oldestLedger'
      | 'oldestLedgerCloseTime'
      | 'status'
      | 'txHash'
    >
  | Omit<
      rpc.Api.GetSuccessfulTransactionResponse,
      | 'latestLedger'
      | 'latestLedgerCloseTime'
      | 'oldestLedger'
      | 'oldestLedgerCloseTime'
      | 'status'
      | 'txHash'
    > {
  if (
    raw.envelopeXdr === undefined ||
    raw.resultXdr === undefined ||
    raw.resultMetaXdr === undefined
  ) {
    throw new TypeError('invalid getTransaction response missing XDR fields');
  }

  const resultMetaXdr = xdr.TransactionMeta.fromXDR(
    raw.resultMetaXdr,
    'base64',
  );
  return {
    ledger: raw.ledger ?? 0,
    createdAt: raw.createdAt ?? 0,
    applicationOrder: raw.applicationOrder ?? 0,
    feeBump: raw.feeBump ?? false,
    envelopeXdr: xdr.TransactionEnvelope.fromXDR(raw.envelopeXdr, 'base64'),
    resultXdr: xdr.TransactionResult.fromXDR(raw.resultXdr, 'base64'),
    resultMetaXdr,
    events: {
      contractEventsXdr:
        raw.events?.contractEventsXdr?.map((eventList) =>
          eventList.map((event) => xdr.ContractEvent.fromXDR(event, 'base64')),
        ) ?? [],
      transactionEventsXdr:
        raw.events?.transactionEventsXdr?.map((event) =>
          xdr.TransactionEvent.fromXDR(event, 'base64'),
        ) ?? [],
    },
    ...(raw.diagnosticEventsXdr === undefined
      ? {}
      : {
          diagnosticEventsXdr: raw.diagnosticEventsXdr.map((event) =>
            xdr.DiagnosticEvent.fromXDR(event, 'base64'),
          ),
        }),
  };
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
 * Default RPC polling sleep strategy.
 *
 * @param _attempt - Poll attempt number.
 * @returns Milliseconds to sleep.
 */
function basicSleepStrategy(_attempt: number): number {
  return 1000;
}

/**
 * Sleeps for the requested duration.
 *
 * @param milliseconds - Duration in milliseconds.
 * @returns Promise that resolves after the timeout.
 */
async function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
