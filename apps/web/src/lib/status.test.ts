import { describe, expect, it } from 'vitest';
import { status } from './status';

describe('web status', () => {
  it('reports web as ok', () => {
    expect(status()).toEqual({ ok: true, service: 'web' });
  });
});
