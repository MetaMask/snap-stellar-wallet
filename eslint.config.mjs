import base, { createConfig } from '@metamask/eslint-config';
import jest from '@metamask/eslint-config-jest';
import typescript from '@metamask/eslint-config-typescript';
import prettierConfig from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';

export default createConfig([
  {
    ignores: [
      'packages/snap/dist/',
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
      'jsdoc/require-jsdoc': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__mocks__/*.ts'],
    extends: [base, typescript, jest, prettierConfig],
    plugins: {
      prettier,
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prettier/prettier': 'error',
      'jest/no-mocks-import': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
      'jest/unbound-method': 'off',
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
