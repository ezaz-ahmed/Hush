import { describe, expect, it } from 'vitest';
import { health, healthStatusSchema } from './health.js';

describe('health', () => {
  it('reports the service as ok', () => {
    expect(health('api')).toEqual({ ok: true, service: 'api' });
  });
});

describe('healthStatusSchema', () => {
  it('accepts what health() returns', () => {
    expect(healthStatusSchema.parse(health('api'))).toEqual({ ok: true, service: 'api' });
  });

  it.each([{ ok: 'yes', service: 'api' }, { ok: true }, null])('rejects %j', (value) => {
    expect(healthStatusSchema.safeParse(value).success).toBe(false);
  });
});
