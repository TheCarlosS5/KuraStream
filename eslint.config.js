import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'library/**', 'legacy_backend/**', '.tools/**', 'frontend/vendor/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'warn',
    },
  },
];
