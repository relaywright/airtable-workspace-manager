const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'coverage/**',
      'node_modules/**',
      '_local-archive/**',
      '.claude/**',
      '.codex/**',
      '.superpowers/**',
      'fixtures/**',
      'release/**',
    ],
  },

  js.configs.recommended,

  // electron/** CommonJS (main process)
  {
    files: ['electron/**/*.js'],
    ignores: ['electron/**/*.test.mjs'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // electron/**/*.test.mjs, scripts/**/*.mjs and test/**/*.mjs — ESM (Node)
  {
    files: ['electron/**/*.test.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },

  // src/** — browser + React renderer
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', argsIgnorePattern: '^_' }],
    },
  },

  // src/**/*.test.jsx and src/test/** — vitest + testing-library globals
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'error',
    },
  },

  // scripts/** (non-.mjs, e.g. any .js helpers) — Node, no-console allowed everywhere
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
  },

  // scripts/**/*.test.mjs — vitest globals on top of Node ESM
  {
    files: ['scripts/**/*.test.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },

  // Root-level config files that use ESM syntax (Vite transpiles these itself
  // regardless of package.json "type") — parse as ESM so lint doesn't choke.
  {
    files: ['vite.config.js', 'vitest.config.js', 'vitest.config.electron.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
  },

  // Other root-level config files (tailwind.config.js, postcss.config.js, eslint.config.js) — Node CJS
  {
    files: ['*.config.js'],
    ignores: ['vite.config.js', 'vitest.config.js', 'vitest.config.electron.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
  },

  // The leveled logger modules are the only files allowed to call console
  // directly; everything else should go through logger.debug/info/warn/error.
  // This must come after the electron/** and src/** blocks above so its
  // 'no-console': 'off' wins the flat-config merge for these two files.
  {
    files: ['electron/logger.js', 'src/utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
