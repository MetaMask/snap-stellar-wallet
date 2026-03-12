import type { ILogger } from '../logger';

export const logger = {
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as ILogger;

export const createPrefixedLogger = (
  _logger: ILogger,
  prefix: string,
): ILogger => {
  return new Proxy(_logger, {
    get(target, prop: keyof ILogger): unknown {
      const method = target[prop];
      if (typeof method === 'function') {
        return (...args: unknown[]) => {
          return (method as (...args: unknown[]) => unknown).call(
            target,
            prefix,
            ...args,
          );
        };
      }
      return method;
    },
  });
};
