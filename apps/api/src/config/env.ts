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
  // Optional: only chat needs it; health, dev and tests run without it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  // Requests per minute on POST /chat, per user id and per client IP.
  CHAT_RATE_LIMIT_PER_USER: z.coerce.number().int().min(1).default(10),
  CHAT_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(30),
});

export type Env = z.infer<typeof envSchema>;

// `KEY=` in .env yields '': drop it for the DB vars, VOYAGE_API_KEY, the ANTHROPIC_* vars and the CHAT_RATE_LIMIT_* vars so it reads as unset (key absent; ANTHROPIC_MODEL and the rate limits fall back to their defaults).
const blankIsUnset = ([key, value]: [string, unknown]): boolean =>
  !(
    (key.startsWith('DATABASE_URL') ||
      key === 'VOYAGE_API_KEY' ||
      key.startsWith('ANTHROPIC_') ||
      key.startsWith('CHAT_RATE_LIMIT_')) &&
    value === ''
  );

export const validateEnv = (raw: Record<string, unknown>): Env =>
  parseEnv(envSchema, Object.fromEntries(Object.entries(raw).filter(blankIsUnset)));
