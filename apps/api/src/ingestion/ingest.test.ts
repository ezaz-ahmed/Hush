import { describe, expect, it } from 'vitest';
import { ingestErrorMessage } from './ingest.js';

describe('ingestErrorMessage', () => {
  it('passes our own messages through', () => {
    expect(ingestErrorMessage(new Error('content/a.md: empty body'))).toBe(
      'content/a.md: empty body',
    );
    expect(ingestErrorMessage(new Error('Invalid env: DATABASE_URL'))).toBe(
      'Invalid env: DATABASE_URL',
    );
  });

  it('hides everything else, keeping only a string code', () => {
    const pg = Object.assign(new Error('password for user bob at db.host'), {
      code: 'ECONNREFUSED',
    });
    expect(ingestErrorMessage(pg)).toBe('ingest failed ECONNREFUSED');
    expect(ingestErrorMessage(new Error('boom'))).toBe('ingest failed');
    expect(ingestErrorMessage(new Error('connect failed for content/ at host x'))).toBe(
      'ingest failed',
    );
    expect(ingestErrorMessage(null)).toBe('ingest failed');
    expect(ingestErrorMessage({ code: 42 })).toBe('ingest failed');
  });
});
