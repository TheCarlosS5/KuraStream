import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'library/**', 'legacy_backend/**', '.tools/**', 'frontend/vendor/**', 'frontend/dist/**', 'android/**', 'test-results/**'],
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
  {
    // k6 scripts run in k6's own runtime (not Node, not a browser)
    files: ['tests/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },
];
