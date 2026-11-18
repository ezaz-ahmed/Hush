import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild (Vitest's default) drops decorator metadata, which Nest's DI needs.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    setupFiles: ['reflect-metadata'],
    // Fake URL: the pool is lazy, and process env beats a developer's real .env.
    env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/hush_test' },
  },
});
