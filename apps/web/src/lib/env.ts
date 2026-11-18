import { parseEnv } from '@hush/shared';
import { z } from 'zod';

export const envSchema = z.object({
  // Empty counts as unset; http(s) only; trailing slash stripped to avoid `//path`.
  API_URL: z
    .preprocess(
      (v) => (v === '' ? undefined : v),
      z.url({ protocol: /^https?$/ }).default('http://localhost:5555'),
    )
    .transform((u) => u.replace(/\/+$/, '')),
});

// Validated on first import; next.config.ts imports this, so a bad value stops dev, build and start.
export const env = parseEnv(envSchema, process.env);
