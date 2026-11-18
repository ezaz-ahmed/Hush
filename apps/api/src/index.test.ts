import { describe, expect, it } from 'vitest';
import { status } from './index.js';

describe('api status', () => {
  it('reports api as ok', () => {
    expect(status()).toEqual({ ok: true, service: 'api' });
  });
});
