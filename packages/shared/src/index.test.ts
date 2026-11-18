import { describe, expect, it } from 'vitest';
import { health } from './index.js';

describe('health', () => {
  it('reports the service as ok', () => {
    expect(health('api')).toEqual({ ok: true, service: 'api' });
  });
});
