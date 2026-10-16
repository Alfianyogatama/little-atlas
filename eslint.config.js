import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Data di public/ dimuat lewat fetch, tidak dibundel (ADR-006). Dipakai ulang di setiap blok
// no-restricted-imports karena flat config menimpa opsi, bukan menggabung.
const publicDataPattern = {
  group: ['**/public', '**/public/**', '@/../public/**'],
  message: 'data di public/ dimuat lewat fetch, jangan diimpor (ADR-006)',
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'spikes',
      'prototype',
      'docs',
      'playwright-report',
      'test-results',
      '.tmp',
      'src/paraglide',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['*.config.{ts,js}', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // Batas modul per folder (AGENTS.md aturan 1 dan 2).
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [publicDataPattern] }] },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'three', 'dexie', 'howler'].map((name) => ({
            name,
            message: 'src/domain harus TypeScript murni (AGENTS.md aturan 1)',
          })),
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                'three/*',
                '@react-three/*',
                '@inlang/*',
                '**/paraglide/**',
                '**/services',
                '**/services/**',
                '**/features',
                '**/features/**',
                '**/globe',
                '**/globe/**',
                '**/ui',
                '**/ui/**',
                '**/app',
                '**/app/**',
              ],
              message: 'src/domain harus TypeScript murni (AGENTS.md aturan 1)',
            },
            publicDataPattern,
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'src/domain harus TypeScript murni: import() dinamis dilarang (AGENTS.md aturan 1)',
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'fetch',
          'indexedDB',
          'localStorage',
          'sessionStorage',
          'AudioContext',
          'webkitAudioContext',
          'speechSynthesis',
          'XMLHttpRequest',
          'WebSocket',
        ].map((name) => ({
          name,
          message: `src/domain harus TypeScript murni: ${name} adalah API peramban (AGENTS.md aturan 1)`,
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...['fetch', 'indexedDB', 'localStorage', 'sessionStorage', 'AudioContext'].map(
          (property) => ({
            object: 'globalThis',
            property,
            message: 'src/domain harus TypeScript murni (AGENTS.md aturan 1)',
          }),
        ),
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['dexie', 'howler', 'idb', 'idb-keyval'].map((name) => ({
            name,
            message: 'akses lewat antarmuka di src/services (AGENTS.md aturan 2)',
          })),
          patterns: [
            {
              group: ['idb/*'],
              message: 'akses lewat antarmuka di src/services (AGENTS.md aturan 2)',
            },
            publicDataPattern,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'fetch',
          'indexedDB',
          'AudioContext',
          'webkitAudioContext',
          'XMLHttpRequest',
          'speechSynthesis',
          'WebSocket',
        ].map((name) => ({
          name,
          message: `akses ${name} lewat antarmuka di src/services (AGENTS.md aturan 2)`,
        })),
        ...['localStorage', 'sessionStorage'].map((name) => ({
          name,
          message: `${name}: penyimpanan lewat repository (AGENTS.md aturan 2 dan 3)`,
        })),
        {
          name: 'Audio',
          message: 'audio lewat src/services (AGENTS.md aturan 2)',
        },
      ],
      'no-restricted-properties': [
        'error',
        ...[
          ['window', 'fetch'],
          ['window', 'indexedDB'],
          ['window', 'AudioContext'],
          ['window', 'speechSynthesis'],
          ['window', 'localStorage'],
          ['window', 'sessionStorage'],
          ['globalThis', 'fetch'],
          ['globalThis', 'indexedDB'],
          ['globalThis', 'speechSynthesis'],
          ['self', 'fetch'],
          ['self', 'indexedDB'],
          ['self', 'localStorage'],
        ].map(([object, property]) => ({
          object,
          property,
          message: `akses ${property} lewat antarmuka di src/services (AGENTS.md aturan 2)`,
        })),
      ],
    },
  },
  {
    files: ['src/globe/**/*.{ts,tsx}', 'src/ui/**/*.tsx'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'warna diambil dari token design system (AGENTS.md)',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'warna diambil dari token design system (AGENTS.md)',
        },
      ],
    },
  },
  prettier,
);
