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
 * A struct to validate and coerce log level from env.
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
 * The app config.
 * Built at module load from env vars injected at build time (see snap.config.ts).
 * Validation throws if the config is invalid; ensure required env vars are set when building the Snap.
 */
export const AppConfig = create(
  {
    environment: process.env.ENVIRONMENT,
    networks: {
      mainnet: {
        rpcUrl: process.env.RPC_URL_MAINNET,
        horizonUrl: process.env.HORIZON_URL_MAINNET,
        explorerBaseUrl: process.env.EXPLORER_MAINNET_BASE_URL,
      },
      testnet: {
        rpcUrl: process.env.RPC_URL_TESTNET,
        horizonUrl: process.env.HORIZON_URL_TESTNET,
        explorerBaseUrl: process.env.EXPLORER_TESTNET_BASE_URL,
      },
    },
    logLevel: process.env.LOG_LEVEL,
  },
  ConfigStruct,
);
