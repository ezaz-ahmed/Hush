import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5555),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(raw);
  // Names only: env values may be secrets, so they never go in the message.
  if (!result.success)
    throw new Error(
      `Invalid env: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );
  return result.data;
};
