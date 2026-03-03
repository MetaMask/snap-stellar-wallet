/* eslint-disable no-empty-function */
import { LogLevel } from '../constants/loglevel';
import { ConfigProvider } from '../services/config';

/**
 * A map of log levels to their priority.
 * Used to determine if a log message should be logged based on the configured log level.
 */
const logLevelPriority = {
  [LogLevel.SILENT]: 0,
  [LogLevel.ERROR]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.INFO]: 3,
  [LogLevel.DEBUG]: 4,
  [LogLevel.TRACE]: 5,
  [LogLevel.ALL]: 6,
};

/**
 * A simple logger utility that provides methods for logging messages at different levels.
 * For now, it's just a wrapper around console.
 */
export type ILogger = {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

/**
 * A decorator function that noops if the log level is less than the configured log level,
 * and runs the decorated function otherwise.
 *
 * @param fn - The function to wrap.
 * @param level - The log level to check against the configured log level.
 * @returns The wrapped function.
 */
const withLogLevel =
  (fn: (...args: unknown[]) => void, level: LogLevel) =>
  (...args: unknown[]): void => {
    if (
      ConfigProvider.get().logLevel in logLevelPriority &&
      logLevelPriority[level] <= logLevelPriority[ConfigProvider.get().logLevel]
    ) {
      fn(...args);
    }
  };

/**
 * A basic logger that wraps the console, extending its functionality to properly log Tron errors.
 */
export const logger: ILogger = {
  log: withLogLevel(console.log, LogLevel.ALL),
  info: withLogLevel(console.info, LogLevel.INFO),
  warn: withLogLevel(console.warn, LogLevel.WARN),
  debug: withLogLevel(console.debug, LogLevel.DEBUG),
  error: withLogLevel(console.error, LogLevel.ERROR),
};

/**
 * A no-op logger that does nothing.
 */
export const noOpLogger: ILogger = {
  log: () => {},
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

/**
 * A logger that prefixes the log message with a given prefix.
 *
 * @param _logger - The logger to prefix. Must be an object with the same methods as the ILogger interface.
 * @param prefix - The prefix to add to the log message.
 * @returns The prefixed logger.
 */
export const createPrefixedLogger = (
  _logger: ILogger,
  prefix: string,
): ILogger => {
  return new Proxy(_logger, {
    get(target, prop: keyof ILogger): unknown {
      const method = target[prop];
      if (typeof method === 'function') {
        return (message: string, ...args: unknown[]) => {
          return method.call(target, prefix, message, ...args);
        };
      }
      return method;
    },
  });
};
