import globals from 'globals';

export default [{
  files: ['js/**/*.js'],
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    globals: { ...globals.browser, maplibregl: 'readonly', Hls: 'readonly' },   // loaded from CDNs in index.html
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    'no-import-assign': 'error',   // ES module bindings are read-only outside their module
    'no-redeclare': 'error',
  },
}];
