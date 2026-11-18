import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild (Vitest's default) drops decorator metadata, which Nest's DI needs.
export default defineConfig({
  plugins: [swc.vite()],
  test: { setupFiles: ['reflect-metadata'] },
});
