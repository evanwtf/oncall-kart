import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.superpowers/',
      '.pw-browsers/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // src/logic is pure game logic: no three.js, no DOM (see AGENTS.md).
    files: ['src/logic/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'requestAnimationFrame',
      ],
    },
  },
  prettier,
);
