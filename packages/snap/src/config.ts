/* eslint-disable no-restricted-globals */
import type { Infer } from '@metamask/superstruct';
import {
  create,
  enums,
  object,
  defaulted,
  coerce,
  string,
} from '@metamask/superstruct';

import { Environment, LogLevel } from './constants';
import { UrlStruct } from './structs';

/**
 * A struct for validating the network config.
 */
const networkConfigStruct = object({
  rpcUrl: UrlStruct,
  horizonUrl: UrlStruct,
  explorerBaseUrl: UrlStruct,
});

/**
 * A Struct to validate and coerce log level from env.
 * Converts the log level to lowercase and checks if it is a valid log level.
 * If the log level is empty, it returns the default log level.
 */
const LogLevelStruct = coerce(
  defaulted(enums(Object.values(LogLevel)), LogLevel.ERROR),
  string(),
  (value: string) => (value === '' ? undefined : value.toLowerCase()),
);

/**
 * A struct for validating the config.
 */
const ConfigStruct = object({
  environment: enums(Object.values(Environment)),
  logLevel: LogLevelStruct,
  networks: object({
    mainnet: networkConfigStruct,
    testnet: networkConfigStruct,
  }),
});

/**
 * The config type.
 */
export type Config = Infer<typeof ConfigStruct>;

/**
 * Reads an env var. Used so config has a single, documented source for build-time env.
 * Values are injected at build time via snap.config.ts `environment`; they are not
 * read from the host at Snap runtime.
 *
 * @param key - The environment variable name (e.g. 'ENVIRONMENT', 'LOG_LEVEL').
 * @returns The value if set and a string, otherwise ''.
 */
const getEnv = (key: string): string => {
  if (typeof process === 'undefined' || !process.env) return '';
  const value = process.env[key];
  return typeof value === 'string' ? value : '';
};

/**
 * The app config.
 * Built at module load from env vars injected at build time (see snap.config.ts).
 * Validation throws if the config is invalid; ensure required env vars are set when building the Snap.
 */
export const AppConfig = create(
  {
    environment: getEnv('ENVIRONMENT'),
    networks: {
      mainnet: {
        rpcUrl: getEnv('RPC_URL_MAINNET'),
        horizonUrl: getEnv('HORIZON_URL_MAINNET'),
        explorerBaseUrl: getEnv('EXPLORER_MAINNET_BASE_URL'),
      },
      testnet: {
        rpcUrl: getEnv('RPC_URL_TESTNET'),
        horizonUrl: getEnv('HORIZON_URL_TESTNET'),
        explorerBaseUrl: getEnv('EXPLORER_TESTNET_BASE_URL'),
      },
    },
    logLevel: getEnv('LOG_LEVEL'),
  },
  ConfigStruct,
);
