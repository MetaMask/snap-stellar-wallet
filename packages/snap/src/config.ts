/* eslint-disable no-restricted-globals */
import type { Infer } from '@metamask/superstruct';
import {
  create,
  enums,
  object,
  defaulted,
  coerce,
  string,
  record,
} from '@metamask/superstruct';

import {
  Environment,
  LogLevelStruct,
  KnownCaip2ChainIdStruct,
  UrlStruct,
  KnownCaip2ChainId,
} from './api';

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
 * A struct for validating the config.
 */
const ConfigStruct = object({
  environment: enums(Object.values(Environment)),
  logLevel: LogLevelStruct,
  networks: record(KnownCaip2ChainIdStruct, networkConfigStruct),
  selectedNetwork: selectedNetworkStruct,
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
  },
  ConfigStruct,
);
