import { KeyringHandler, RpcHandler } from './handlers';
import { ConfigProvider } from './services/config';
import { logger } from './utils';

ConfigProvider.initializeConfig();

const keyringHandler = new KeyringHandler({ logger });
const rpcHandler = new RpcHandler({ logger });

export { keyringHandler, rpcHandler };
