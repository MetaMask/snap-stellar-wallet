import base, { createConfig } from '@metamask/eslint-config';
import browser from '@metamask/eslint-config-browser';
import jest from '@metamask/eslint-config-jest';
import typescript from '@metamask/eslint-config-typescript';
import prettierConfig from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';

export default createConfig([
  {
    ignores: [
      'packages/snap/dist/',
      'packages/site/.cache/',
      'packages/site/public/',
    ],
  },
  {
    files: ['packages/snap/**/*.{ts,tsx}'],
    extends: [base, typescript, prettierConfig],
    plugins: {
      prettier,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'id-length': ['warn', { exceptions: ['t'] }], // Used for the localized translator helper.
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['packages/site/**/*.{ts,tsx}'],
    extends: [base, typescript, browser, prettierConfig],
    plugins: {
      prettier,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off', // this rule should be removed eventually for non tests files,
      '@typescript-eslint/no-misused-promises': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [base, typescript, jest, prettierConfig],
    plugins: {
      prettier,
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['**/snap.config.ts'],
    extends: [prettierConfig],
    plugins: {
      prettier,
    },
    rules: {
      'import-x/no-nodejs-modules': 'off',
      'no-restricted-globals': 'off',
      'prettier/prettier': 'error',
    },
  },
]);
