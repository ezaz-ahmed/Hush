import type { z } from 'zod';

export const parseEnv = <T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>,
): z.output<T> => {
  const result = schema.safeParse(raw);
  // Names only: env values may be secrets, so they never go in the message.
  if (!result.success)
    throw new Error(
      `Invalid env: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );
  return result.data;
};
