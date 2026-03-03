import { KeyringHandler, RpcHandler } from './handlers';
import { logger } from './utils';

const keyringHandler = new KeyringHandler({ logger });
const rpcHandler = new RpcHandler({ logger });

export { keyringHandler, rpcHandler };
