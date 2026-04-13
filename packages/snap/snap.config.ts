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
    TOKEN_API_BASE_URL: process.env.TOKEN_API_BASE_URL ?? '',
    TOKEN_API_CHUNK_SIZE: process.env.TOKEN_API_CHUNK_SIZE ?? '',
    STATIC_API_BASE_URL: process.env.STATIC_API_BASE_URL ?? '',
  },
  polyfills: true,
};

export default config;
