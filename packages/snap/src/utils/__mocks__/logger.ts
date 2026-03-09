import type { ILogger } from '../logger';

const actual = jest.requireActual('../logger');

export const logger = {
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as ILogger;

export const { createPrefixedLogger } = actual;
