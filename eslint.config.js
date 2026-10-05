import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'library/**', 'legacy_backend/**', '.tools/**', 'frontend/vendor/**', 'android/**', 'test-results/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, lucide: 'readonly', SubtitlesOctopus: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  {
    files: ['frontend/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
];
