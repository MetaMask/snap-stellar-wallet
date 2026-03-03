/* eslint-disable no-restricted-globals */
import { ConfigProvider } from './ConfigProvider';

describe('ConfigProvider', () => {
  let OriginalEnvironment: string | undefined;
  let OriginalRpcUrlMainnet: string | undefined;
  let OriginalHorizonUrlMainnet: string | undefined;
  let OriginalExplorerMainnetBaseUrl: string | undefined;
  let OriginalRpcUrlTestnet: string | undefined;
  let OriginalHorizonUrlTestnet: string | undefined;
  let OriginalExplorerTestnetBaseUrl: string | undefined;
  let OriginalLogLevel: string | undefined;

  beforeEach(() => {
    OriginalEnvironment = process.env.ENVIRONMENT;
    OriginalRpcUrlMainnet = process.env.RPC_URL_MAINNET;
    OriginalHorizonUrlMainnet = process.env.HORIZON_URL_MAINNET;
    OriginalExplorerMainnetBaseUrl = process.env.EXPLORER_MAINNET_BASE_URL;
    OriginalRpcUrlTestnet = process.env.RPC_URL_TESTNET;
    OriginalHorizonUrlTestnet = process.env.HORIZON_URL_TESTNET;
    OriginalExplorerTestnetBaseUrl = process.env.EXPLORER_TESTNET_BASE_URL;
    OriginalLogLevel = process.env.LOG_LEVEL;

    process.env.ENVIRONMENT = 'local';
    process.env.RPC_URL_MAINNET = 'https://mainnet.stellar.org';
    process.env.HORIZON_URL_MAINNET = 'https://mainnet.stellar.org';
    process.env.EXPLORER_MAINNET_BASE_URL = 'https://mainnet.stellar.org';
    process.env.RPC_URL_TESTNET = 'https://testnet.stellar.org';
    process.env.HORIZON_URL_TESTNET = 'https://testnet.stellar.org';
    process.env.EXPLORER_TESTNET_BASE_URL = 'https://testnet.stellar.org';
    process.env.LOG_LEVEL = 'info';
  });

  afterEach(() => {
    process.env.ENVIRONMENT = OriginalEnvironment;
    process.env.RPC_URL_MAINNET = OriginalRpcUrlMainnet;
    process.env.HORIZON_URL_MAINNET = OriginalHorizonUrlMainnet;
    process.env.EXPLORER_MAINNET_BASE_URL = OriginalExplorerMainnetBaseUrl;
    process.env.RPC_URL_TESTNET = OriginalRpcUrlTestnet;
    process.env.HORIZON_URL_TESTNET = OriginalHorizonUrlTestnet;
    process.env.EXPLORER_TESTNET_BASE_URL = OriginalExplorerTestnetBaseUrl;
    process.env.LOG_LEVEL = OriginalLogLevel;
  });

  describe('get', () => {
    it('return the parsed config', () => {
      ConfigProvider.initializeConfig();
      const config = ConfigProvider.get();

      expect(config.environment).toBe('local');
      expect(config.networks.mainnet.rpcUrl).toBe(
        'https://mainnet.stellar.org',
      );
      expect(config.networks.mainnet.horizonUrl).toBe(
        'https://mainnet.stellar.org',
      );
      expect(config.networks.mainnet.explorerBaseUrl).toBe(
        'https://mainnet.stellar.org',
      );
      expect(config.networks.testnet.rpcUrl).toBe(
        'https://testnet.stellar.org',
      );
      expect(config.networks.testnet.horizonUrl).toBe(
        'https://testnet.stellar.org',
      );
      expect(config.networks.testnet.explorerBaseUrl).toBe(
        'https://testnet.stellar.org',
      );
      expect(config.logLevel).toBe('info');
    });
  });

  describe('initializeConfig', () => {
    it('throw an error if the config is not valid', () => {
      process.env.ENVIRONMENT = 'invalid';
      expect(() => ConfigProvider.initializeConfig()).toThrow(
        'Expected one of `"local","test","production"`, but received: "invalid"',
      );
    });

    it('set the default log level if the log level is not set', () => {
      process.env.LOG_LEVEL = '';
      ConfigProvider.initializeConfig();
      const config = ConfigProvider.get();
      expect(config.logLevel).toBe('error');
    });
  });
});
