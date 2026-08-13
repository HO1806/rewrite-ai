import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'store-assets'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests exercise error paths and mock host APIs, so they need more latitude.
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    /**
     * Playwright fixtures take a callback named `use` and destructure `{}` when a
     * fixture needs no dependencies. The react-hooks rule reads `use` as React's
     * hook of the same name, and neither convention is negotiable, so both rules
     * are off for the e2e suite only.
     */
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
);
