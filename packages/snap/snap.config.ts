import type { SnapConfig } from '@metamask/snaps-cli';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';

dotenv();

const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.ts'),
  server: {
    port: 8080,
  },
  environment: {
    ENVIRONMENT: process.env.ENVIRONMENT ?? '',
    LOG_LEVEL: process.env.LOG_LEVEL ?? '',
    RPC_URL_MAINNET: process.env.RPC_URL_MAINNET ?? '',
    HORIZON_URL_MAINNET: process.env.HORIZON_URL_MAINNET ?? '',
    EXPLORER_MAINNET_BASE_URL: process.env.EXPLORER_MAINNET_BASE_URL ?? '',
    RPC_URL_TESTNET: process.env.RPC_URL_TESTNET ?? '',
    HORIZON_URL_TESTNET: process.env.HORIZON_URL_TESTNET ?? '',
    EXPLORER_TESTNET_BASE_URL: process.env.EXPLORER_TESTNET_BASE_URL ?? '',
    TRANSACTION_TIMEOUT: process.env.TRANSACTION_TIMEOUT ?? '',
    TRANSACTION_POLLING_ATTEMPTS:
      process.env.TRANSACTION_POLLING_ATTEMPTS ?? '',
    TRACK_TRANSACTION_MAX_RESCHEDULES:
      process.env.TRACK_TRANSACTION_MAX_RESCHEDULES ?? '',
    TOKEN_API_BASE_URL: process.env.TOKEN_API_BASE_URL ?? '',
    STATIC_API_BASE_URL: process.env.STATIC_API_BASE_URL ?? '',
    PRICE_API_BASE_URL: process.env.PRICE_API_BASE_URL ?? '',
    SECURITY_ALERTS_API_BASE_URL:
      process.env.SECURITY_ALERTS_API_BASE_URL ?? '',
    FIAT_EXCHANGE_RATES_TTL_MILLISECONDS:
      process.env.FIAT_EXCHANGE_RATES_TTL_MILLISECONDS ?? '',
    HISTORICAL_PRICES_TTL_MILLISECONDS:
      process.env.HISTORICAL_PRICES_TTL_MILLISECONDS ?? '',
    SPOT_PRICES_TTL_MILLISECONDS:
      process.env.SPOT_PRICES_TTL_MILLISECONDS ?? '',
    BASE_FEE_TTL_MILLISECONDS: process.env.BASE_FEE_TTL_MILLISECONDS ?? '',
    LOAD_ON_CHAIN_ACCOUNT_TTL_MILLISECONDS:
      process.env.LOAD_ON_CHAIN_ACCOUNT_TTL_MILLISECONDS ?? '',
    SIMULATE_TRANSACTION_TTL_MILLISECONDS:
      process.env.SIMULATE_TRANSACTION_TTL_MILLISECONDS ?? '',
    SEP41_ASSET_BALANCE_TTL_MILLISECONDS:
      process.env.SEP41_ASSET_BALANCE_TTL_MILLISECONDS ?? '',
    BASE_FEE_MULTIPLIER: process.env.BASE_FEE_MULTIPLIER ?? '',
    SIMULATION_FEE_MULTIPLIER: process.env.SIMULATION_FEE_MULTIPLIER ?? '',
  },
  polyfills: true,
};

export default config;
