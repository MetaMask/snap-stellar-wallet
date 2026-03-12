import { assert, StructError, create } from '@metamask/superstruct';

import { LogLevel, LogLevelStruct } from './loglevel';

describe('LogLevelStruct', () => {
  it.each(Object.values(LogLevel))(
    'accepts valid log level: %s',
    (logLevel) => {
      expect(() => assert(logLevel, LogLevelStruct)).not.toThrow();
    },
  );

  it('rejects an invalid log level', () => {
    const logLevel = 'invalid-log-level';
    expect(() => assert(logLevel, LogLevelStruct)).toThrow(StructError);
  });

  it('returns the default log level if the log level is not provided', () => {
    const logLevel = undefined;
    const result = create(logLevel, LogLevelStruct);

    expect(result).toStrictEqual(LogLevel.ERROR);
  });
});
