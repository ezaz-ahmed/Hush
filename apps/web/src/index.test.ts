import { describe, expect, it } from 'vitest';
import { status } from './index.js';

describe('web status', () => {
  it('uses the shared health helper', () => {
    expect(status()).toEqual({ ok: true, service: 'web' });
  });
});
