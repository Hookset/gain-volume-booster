// ESLint flat config for Gain - Volume Booster (MV2 Firefox extension, plain browser scripts)

const browserGlobals = {
  // WebExtension API
  browser: 'readonly',
  // DOM / Web APIs
  window: 'writable',
  document: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  history: 'readonly',
  AudioContext: 'readonly',
  MutationObserver: 'readonly',
  URL: 'readonly',
  WeakMap: 'readonly',
  // Built-ins
  Set: 'readonly',
  Promise: 'readonly',
  Math: 'readonly',
  String: 'readonly',
  Array: 'readonly',
  Number: 'readonly',
  Boolean: 'readonly',
  Object: 'readonly',
  isFinite: 'readonly',
  parseInt: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

// Functions declared in site-utils.js and available as globals in all other scripts
const siteUtilsGlobals = {
  normalizeHostname: 'readonly',
  normalizeDomain: 'readonly',
  isIPv4Hostname: 'readonly',
  getSitePatterns: 'readonly',
  matchesList: 'readonly',
  getHostnameFromUrl: 'readonly',
  isSupportedTabUrl: 'readonly',
  hasPersistentSiteAccess: 'readonly',
  MSG: 'readonly',
  TAB_AUDIO_STATE_PREFIX: 'readonly',
  DEFAULT_AUDIO_STATE: 'readonly',
  VOL_MAX: 'readonly',
  VOL_AMBER: 'readonly',
  VOL_RED: 'readonly',
  volColor: 'readonly',
  SUPPORT_URL: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['site-utils.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'radix': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      // vars: 'local' — top-level declarations are intentionally exported as globals
      'no-unused-vars': ['warn', { vars: 'local', args: 'after-used', caughtErrors: 'none' }],
      'no-undef': 'error',
    },
  },
  {
    files: ['background.js', 'popup.js', 'options.js', 'options-theme.js', 'popup-theme.js', 'content.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...browserGlobals,
        ...siteUtilsGlobals,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'radix': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      // caughtErrors: 'none' — empty catch blocks are intentional throughout
      'no-unused-vars': ['warn', { vars: 'all', args: 'after-used', caughtErrors: 'none' }],
      'no-undef': 'error',
    },
  },
];
