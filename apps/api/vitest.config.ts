import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

// esbuild (Vitest's default) drops decorator metadata, which Nest's DI needs.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    setupFiles: ['reflect-metadata'],
    // Fake URL: the pool is lazy, and process env beats a developer's real .env.
    env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/hush_test' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, '**/dist/**', '**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'int',
          include: ['src/**/*.int.test.ts'],
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
