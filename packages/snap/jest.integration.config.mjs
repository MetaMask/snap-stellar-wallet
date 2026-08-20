// @ts-check
/**
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/integration-test/**/*.test.ts'],
  testTimeout: 60_000,
};

export default config;
