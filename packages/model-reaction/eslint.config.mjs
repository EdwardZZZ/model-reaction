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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
  // Protect the documented module boundaries; the DevTools edge to the shared
  // reaction graph remains intentional.
  {
    files: ['src/react/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../core/**', '../reaction/**', '../devtools/**'],
          message: 'React adapters must depend on the public model contract, not internal runtime modules.',
        }],
      }],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../react/**', '../devtools/**'],
          message: 'Core runtime modules must not depend on UI adapters or DevTools.',
        }],
      }],
    },
  },
  {
    files: ['src/reaction/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../react/**', '../devtools/**', '../core/model-manager'],
          message: 'Reaction scheduling must not depend on UI, DevTools, or the ModelManager implementation.',
        }],
      }],
    },
  },
  {
    files: ['src/devtools/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../core/**', '../react/**'],
          message: 'DevTools must observe models through the public API, not core or React internals.',
        }],
      }],
    },
  },
  // Looser rules for tests
  {
    files: ['src/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  // Looser rules for examples (illustrative scripts, not lib code)
  {
    files: ['examples/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
