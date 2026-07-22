/* eslint-disable no-restricted-globals */
import type { Infer, Struct } from '@metamask/superstruct';
import {
  create,
  enums,
  object,
  defaulted,
  coerce,
  string,
  record,
  number,
  min,
} from '@metamask/superstruct';

import {
  Environment,
  LogLevelStruct,
  KnownCaip2ChainIdStruct,
  UrlStruct,
  KnownCaip2ChainId,
} from './api';

const DEFAULT_TOKEN_API_BASE_URL = 'https://tokens.api.cx.metamask.io';

const DEFAULT_STATIC_API_BASE_URL = 'https://static.cx.metamask.io';

const DEFAULT_PRICE_API_BASE_URL = 'https://price.api.cx.metamask.io';

const DEFAULT_SECURITY_ALERTS_API_BASE_URL =
  'https://security-alerts.api.cx.metamask.io';

/**
 * A struct to parse an integer from a string.
 *
 * @param minValue - The minimum value for the integer.
 * @param defaultValue - The default value for the integer.
 * @returns A struct to parse an integer from a string.
 */
const parseIntegerStruct = (
  minValue: number,
  defaultValue: number,
): Struct<number> =>
  coerce(
    defaulted(min(number(), minValue), defaultValue),
    string(),
    (value: string) => (value === '' ? undefined : parseInt(value, 10)),
  );

const parseFloatStruct = (
  minValue: number,
  defaultValue: number,
): Struct<number> =>
  coerce(
    defaulted(min(number(), minValue), defaultValue),
    string(),
    (value: string) => (value === '' ? undefined : parseFloat(value)),
  );

/**
 * A struct for validating the network config.
 */
const networkConfigStruct = object({
  rpcUrl: UrlStruct,
  horizonUrl: UrlStruct,
  explorerBaseUrl: UrlStruct,
});

/**
 * A struct to validate and coerce the selected network from env.
 * Converts the selected network to lowercase and checks if it is a valid selected network.
 * If the selected network is empty, it returns the default selected network.
 */
const selectedNetworkStruct = coerce(
  defaulted(KnownCaip2ChainIdStruct, KnownCaip2ChainId.Mainnet),
  string(),
  (value: string) => (value === '' ? undefined : value.toLowerCase()),
);

/**
 * A struct for validating the network config map.
 */
const networkConfigMapStruct = record(
  KnownCaip2ChainIdStruct,
  networkConfigStruct,
);

/**
 * A struct for validating the config.
 */
const ConfigStruct = object({
  environment: enums(Object.values(Environment)),
  logLevel: LogLevelStruct,
  networks: networkConfigMapStruct,
  selectedNetwork: selectedNetworkStruct,
  transaction: object({
    timeout: parseIntegerStruct(100, 180),
    pollingAttempts: parseIntegerStruct(0, 10),
    /**
     * Maximum background reschedules for the track-transaction cron job while Horizon has not
     * indexed the transaction (404). Each reschedule is a separate cron run via
     * `scheduleBackgroundEvent`, not an in-process retry loop.
     */
    trackTransactionMaxReschedules: parseIntegerStruct(0, 10),
    /**
     * Multiplier applied to the Stellar network base fee to set the per-operation inclusion fee on
     * submitted transactions. Inclusion fee determines ledger ordering; it is separate from
     * the Soroban resource fee returned by simulation.
     *
     * @see https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
     */
    baseFeeMultiplier: parseFloatStruct(1, 10),
    /**
     * The maximum fee threshold in XLM for the Stellar network.
     */
    maxFeeThresholdInXLM: parseFloatStruct(1, 1),
    /**
     * The maximum number of Horizon not-found reconcile attempts for a pending transaction.
     * Used with `maxPendingTransactionAge` to evict stale pending txs from snap state;
     * both limits must be exceeded before a pending tx is dropped.
     * Minimum value is 2 to avoid dropping the pending transaction too early.
     */
    maxReconcileAttempts: parseIntegerStruct(2, 5),
    /**
     * The maximum age of a pending transaction in milliseconds.
     * Used with `maxReconcileAttempts` to evict stale pending txs from snap state;
     * both limits must be exceeded before a pending tx is dropped.
     * Minimum value is 15000 to avoid dropping the pending transaction too early.
     */
    maxPendingTransactionAge: parseIntegerStruct(15000, 30000),
  }),
  api: object({
    tokenApi: object({
      baseUrl: UrlStruct,
    }),
    staticApi: object({
      baseUrl: UrlStruct,
    }),
    priceApi: object({
      baseUrl: UrlStruct,
    }),
    securityAlertsApi: object({
      baseUrl: UrlStruct,
    }),
  }),
  cache: object({
    ttlMilliseconds: object({
      // 1 hour
      spotPrices: parseIntegerStruct(1000, 60 * 60 * 1000 * 1),
      // 1 hour
      fiatExchangeRates: parseIntegerStruct(1000, 60 * 60 * 1000 * 1),
      // 1 hour
      historicalPrices: parseIntegerStruct(1000, 60 * 60 * 1000 * 1),
      // 1 hour
      baseFee: parseIntegerStruct(1000, 60 * 60 * 1000 * 1),
      // 10 minutes (Horizon account payload; aligns with on-chain account cache usage)
      loadOnChainAccount: parseIntegerStruct(1000, 10 * 60 * 1000 * 1),
      // Short: simulation is sequence- and footprint-sensitive
      simulateTransaction: parseIntegerStruct(1000, 10 * 1000),
      // SEP-41 balance reads (multicall on mainnet)
      sep41AssetBalance: parseIntegerStruct(1000, 30 * 1000),
    }),
  }),
});

/**
 * The config type.
 */
export type Config = Infer<typeof ConfigStruct>;

/**
 * The network config type.
 */
export type NetworkConfig = Infer<typeof networkConfigStruct>;

/**
 * The app config.
 * Built at module load from env vars injected at build time (see snap.config.ts).
 * Validation throws if the config is invalid; ensure required env vars are set when building the Snap.
 */
export const AppConfig = create(
  {
    environment: process.env.ENVIRONMENT,
    networks: {
      [KnownCaip2ChainId.Mainnet]: {
        rpcUrl: process.env.RPC_URL_MAINNET,
        horizonUrl: process.env.HORIZON_URL_MAINNET,
        explorerBaseUrl: process.env.EXPLORER_MAINNET_BASE_URL,
      },
      [KnownCaip2ChainId.Testnet]: {
        rpcUrl: process.env.RPC_URL_TESTNET,
        horizonUrl: process.env.HORIZON_URL_TESTNET,
        explorerBaseUrl: process.env.EXPLORER_TESTNET_BASE_URL,
      },
    },
    selectedNetwork: KnownCaip2ChainId.Mainnet,
    logLevel: process.env.LOG_LEVEL,
    transaction: {
      timeout: process.env.TRANSACTION_TIMEOUT,
      pollingAttempts: process.env.TRANSACTION_POLLING_ATTEMPTS,
      baseFeeMultiplier: process.env.BASE_FEE_MULTIPLIER,
      maxFeeThresholdInXLM: process.env.MAX_FEE_THRESHOLD_IN_XLM,
      trackTransactionMaxReschedules:
        process.env.TRACK_TRANSACTION_MAX_RESCHEDULES,
      maxReconcileAttempts: process.env.MAX_RECONCILE_ATTEMPTS,
      maxPendingTransactionAge: process.env.MAX_PENDING_TRANSACTION_AGE,
    },
    api: {
      tokenApi: {
        baseUrl:
          process.env.TOKEN_API_BASE_URL === ''
            ? DEFAULT_TOKEN_API_BASE_URL
            : (process.env.TOKEN_API_BASE_URL ?? DEFAULT_TOKEN_API_BASE_URL),
      },
      staticApi: {
        baseUrl:
          process.env.STATIC_API_BASE_URL === ''
            ? DEFAULT_STATIC_API_BASE_URL
            : (process.env.STATIC_API_BASE_URL ?? DEFAULT_STATIC_API_BASE_URL),
      },
      priceApi: {
        baseUrl:
          process.env.PRICE_API_BASE_URL === ''
            ? DEFAULT_PRICE_API_BASE_URL
            : (process.env.PRICE_API_BASE_URL ?? DEFAULT_PRICE_API_BASE_URL),
      },
      securityAlertsApi: {
        baseUrl:
          process.env.SECURITY_ALERTS_API_BASE_URL === ''
            ? DEFAULT_SECURITY_ALERTS_API_BASE_URL
            : (process.env.SECURITY_ALERTS_API_BASE_URL ??
              DEFAULT_SECURITY_ALERTS_API_BASE_URL),
      },
    },
    cache: {
      ttlMilliseconds: {
        spotPrices: process.env.SPOT_PRICES_TTL_MILLISECONDS,
        fiatExchangeRates: process.env.FIAT_EXCHANGE_RATES_TTL_MILLISECONDS,
        historicalPrices: process.env.HISTORICAL_PRICES_TTL_MILLISECONDS,
        baseFee: process.env.BASE_FEE_TTL_MILLISECONDS,
        loadOnChainAccount: process.env.LOAD_ON_CHAIN_ACCOUNT_TTL_MILLISECONDS,
        simulateTransaction: process.env.SIMULATE_TRANSACTION_TTL_MILLISECONDS,
        sep41AssetBalance: process.env.SEP41_ASSET_BALANCE_TTL_MILLISECONDS,
      },
    },
  },
  ConfigStruct,
);
