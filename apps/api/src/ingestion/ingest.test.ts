import { describe, expect, it } from 'vitest';
import { EmbeddingError } from '../embedding/embedding-provider.js';
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

  it('passes EmbeddingError messages through (they never carry input text or keys)', () => {
    expect(
      ingestErrorMessage(new EmbeddingError('embedding request failed: status 429 (batch 1)')),
    ).toBe('embedding request failed: status 429 (batch 1)');
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
