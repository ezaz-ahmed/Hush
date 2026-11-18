import { parseEnv } from '@hush/shared';
import { z } from 'zod';

// shortcut: optional until a DB client exists, #12 makes these required.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, hostname: z.regexes.hostname }).optional();

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5555),
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl,
});

export type Env = z.infer<typeof envSchema>;

// `KEY=` in .env yields '': drop it for the DB vars so it reads as unset (key absent, not undefined).
const blankIsUnset = ([key, value]: [string, unknown]): boolean =>
  !(key.startsWith('DATABASE_URL') && value === '');

export const validateEnv = (raw: Record<string, unknown>): Env =>
  parseEnv(envSchema, Object.fromEntries(Object.entries(raw).filter(blankIsUnset)));
