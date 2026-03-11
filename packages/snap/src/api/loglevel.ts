import { coerce, defaulted, enums, string } from '@metamask/superstruct';

export enum LogLevel {
  ALL = 'all',
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  SILENT = 'silent',
}

/**
 * A struct to validate and coerce log level from env.
 * Converts the log level to lowercase and checks if it is a valid log level.
 * If the log level is empty, it returns the default log level.
 */
export const LogLevelStruct = coerce(
  defaulted(enums(Object.values(LogLevel)), LogLevel.ERROR),
  string(),
  (value: string) => (value === '' ? undefined : value.toLowerCase()),
);
