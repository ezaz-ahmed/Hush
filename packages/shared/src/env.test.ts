import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnv } from './env.js';

const schema = z.object({
  REQUIRED: z.string().min(1),
  PORT: z.coerce.number().int().default(5555),
});

describe('parseEnv', () => {
  it('returns the parsed output for valid input', () => {
    expect(parseEnv(schema, { REQUIRED: 'x', PORT: '80' })).toEqual({ REQUIRED: 'x', PORT: 80 });
  });

  it('names a missing required var and nothing else', () => {
    expect(() => parseEnv(schema, {})).toThrow(new Error('Invalid env: REQUIRED'));
  });

  it('names every bad var once', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(
      new Error('Invalid env: REQUIRED, PORT'),
    );
  });

  it('names a var once even when it fails several checks', () => {
    const multi = z.object({ TOKEN: z.string().min(5).regex(/x/) });
    expect(() => parseEnv(multi, { TOKEN: 'ab' })).toThrow(new Error('Invalid env: TOKEN'));
  });

  it('never includes values, bad or unrelated', () => {
    const secret = 's3cr3t-value';
    expect(() => parseEnv(schema, { PORT: secret, OTHER: 'unrelated-s3cr3t' })).toThrow(
      /^(?!.*s3cr3t).*$/s,
    );
  });
});
