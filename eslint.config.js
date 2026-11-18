import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import path from 'node:path';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist', '**/.turbo', '**/.next', '**/next-env.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{js,mjs,ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
    // Absolute because Turbo runs eslint from inside apps/web.
    settings: { next: { rootDir: path.join(import.meta.dirname, 'apps/web') } },
  },
);
