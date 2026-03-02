import { config } from 'dotenv';

config();

// Set default environment for tests if not already set
// eslint-disable-next-line no-restricted-globals
process.env.ENVIRONMENT ??= 'test';
