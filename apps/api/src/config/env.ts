import { parseEnv } from '@hush/shared';
import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, hostname: z.regexes.hostname });

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5555),
  DATABASE_URL: postgresUrl,
  // Optional: read only by drizzle-kit (drizzle.config.ts), never by the API.
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
  // Optional: only ingest (#22) and, later, query embedding need it; health, dev and tests run without it.
  VOYAGE_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

// `KEY=` in .env yields '': drop it for the DB vars and VOYAGE_API_KEY so it reads as unset (key absent, not undefined).
const blankIsUnset = ([key, value]: [string, unknown]): boolean =>
  !((key.startsWith('DATABASE_URL') || key === 'VOYAGE_API_KEY') && value === '');

export const validateEnv = (raw: Record<string, unknown>): Env =>
  parseEnv(envSchema, Object.fromEntries(Object.entries(raw).filter(blankIsUnset)));
