import path from 'node:path';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist', '**/.turbo', '**/.next', '**/next-env.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/order': 'error',
    },
  },
  {
    // Named exports only (#1 convention); scoped to shared so Next pages and configs keep default exports.
    files: ['packages/shared/src/**/*.ts'],
    rules: { 'import-x/no-default-export': 'error' },
  },
  {
    files: ['apps/web/**/*.{js,mjs,ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-img-element': 'error', // Next defaults to warn, which CI would not block
    },
    // Absolute because Turbo runs eslint from inside apps/web.
    settings: { next: { rootDir: path.join(import.meta.dirname, 'apps/web') } },
  },
);
