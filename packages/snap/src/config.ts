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
  }),
  api: object({
    tokenApi: object({
      baseUrl: UrlStruct,
      chunkSize: parseIntegerStruct(1, 100),
    }),
    staticApi: object({
      baseUrl: UrlStruct,
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
    },
    api: {
      tokenApi: {
        baseUrl: process.env.TOKEN_API_BASE_URL,
        chunkSize: process.env.TOKEN_API_CHUNK_SIZE,
      },
      staticApi: {
        baseUrl: process.env.STATIC_API_BASE_URL,
      },
    },
  },
  ConfigStruct,
);
