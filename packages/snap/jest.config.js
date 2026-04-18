// @ts-check
/**
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
const config = {
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: ['./src/**/*.ts', './src/**/*.tsx'],

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: [
    '.*/index\\.ts$', // any index.ts
    '.*/constants\\.ts$', // any file named constants.ts
    '.*/constants/', // any file in a folder named constants
    '.*/utils/logger\\.ts$', // skip logger.ts
    '.*/permissions\\.ts$', // skip permissions.ts
    '.*/context\\.ts$', // skip context.ts
    '.*/config\\.ts$', // skip config.ts
    '.*/utils/snap\\.ts$', // skip snap.ts
  ],

  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: 'babel',

  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: ['text', 'html', 'json-summary', 'lcov'],

  // An object that configures minimum threshold enforcement for coverage results
  coverageThreshold: {
    global: {
      branches: 61.05,
      functions: 75.86,
      lines: 77.65,
      statements: 77.83,
    },
  },

  preset: '@metamask/snaps-jest',
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '\\.svg$': 'jest-transform-stub',
  },
  resetMocks: true,
  testMatch: ['**/src/**/?(*.)+(spec|test).[tj]s?(x)'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

module.exports = config;
