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

import { Environment, LogLevel } from '../../constants';
import { UrlStruct } from '../../structs';

/**
 * A struct for validating the network config.
 */
const networkConfigStruct = object({
  rpcUrl: UrlStruct,
  horizonUrl: UrlStruct,
  explorerBaseUrl: UrlStruct,
});

/**
 * A coerce function for validating log levels.
 * Converts the log level to lowercase and checks if it is a valid log level.
 * If the log level is empty, it returns the default log level.
 *
 * @returns The validated log level.
 */
const LogLevelCoerce = coerce(
  defaulted(enums(Object.values(LogLevel)), LogLevel.ERROR),
  string(),
  (value: string) => (value === '' ? undefined : value.toLowerCase()),
);

/**
 * A struct for validating the config.
 */
const ConfigStruct = object({
  environment: enums(Object.values(Environment)),
  logLevel: LogLevelCoerce,
  networks: object({
    mainnet: networkConfigStruct,
    testnet: networkConfigStruct,
  }),
});

/**
 * The config type.
 */
export type Config = Infer<typeof ConfigStruct>;

export class ConfigProvider {
  /**
   * The config.
   */
  static config: Config;

  /**
   * Initializes the config.
   * Reads the environment variables and validates them.
   * Sets the config.
   */
  static initializeConfig(): void {
    const rawEnvironment = {
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
    };

    ConfigProvider.config = create(rawEnvironment, ConfigStruct);
  }

  /**
   * Returns the config.
   *
   * @returns The config.
   */
  static get(): Config {
    return ConfigProvider.config;
  }
}
