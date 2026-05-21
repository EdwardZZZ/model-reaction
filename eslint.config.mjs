import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',  // TODO: consider enabling
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
  // Looser rules for tests
  {
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  // Looser rules for examples (illustrative scripts, not lib code)
  {
    files: ['examples/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
