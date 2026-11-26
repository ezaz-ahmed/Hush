import { describe, expect, it } from 'vitest';
import type { Db } from '../database/database.module.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { MAX_TOP_K, retrieve } from './retrieve.js';

// Any property access fails the test: proves retrieve did not touch the database.
const untouchedDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`db touched: ${String(prop)}`);
    },
  },
) as Db;

const QUERY = 'secret-query-text';

describe('retrieve guards', () => {
  it.each([{ topK: 0 }, { topK: MAX_TOP_K + 1 }, { topK: 2.5 }, { topK: NaN }])(
    'rejects %o with RangeError before embedding',
    async (options) => {
      const embedder = new FakeEmbeddingProvider();
      const promise = retrieve(untouchedDb, embedder, QUERY, options);
      await expect(promise).rejects.toBeInstanceOf(RangeError);
      await expect(promise).rejects.not.toThrow(QUERY);
      expect(embedder.calls).toHaveLength(0);
    },
  );

  it.each([{ minScore: -1.1 }, { minScore: 1.1 }, { minScore: NaN }])(
    'rejects %o with RangeError before embedding',
    async (options) => {
      const embedder = new FakeEmbeddingProvider();
      const promise = retrieve(untouchedDb, embedder, QUERY, options);
      await expect(promise).rejects.toBeInstanceOf(RangeError);
      await expect(promise).rejects.not.toThrow(QUERY);
      expect(embedder.calls).toHaveLength(0);
    },
  );

  it.each(['', '   ', '\n\t '])('returns [] for blank query %j without embedding', async (q) => {
    const embedder = new FakeEmbeddingProvider();
    await expect(retrieve(untouchedDb, embedder, q)).resolves.toEqual([]);
    expect(embedder.calls).toHaveLength(0);
  });

  it('passes an EmbeddingError through unchanged and does not touch the db', async () => {
    const error = new EmbeddingError('voyage failed: status 500');
    const failing: EmbeddingProvider = { embed: () => Promise.reject(error) };
    await expect(retrieve(untouchedDb, failing, QUERY)).rejects.toBe(error);
  });

  it('accepts topK MAX_TOP_K, embedding exactly once with ([query], "query")', async () => {
    const fake = new FakeEmbeddingProvider();
    await expect(retrieve(untouchedDb, fake, QUERY, { topK: MAX_TOP_K })).rejects.toThrow(
      'db touched',
    );
    expect(fake.calls).toEqual([{ texts: [QUERY], inputType: 'query' }]);
  });

  it('throws EmbeddingError when the provider returns no vector, without leaking the query or touching the db', async () => {
    const empty: EmbeddingProvider = { embed: () => Promise.resolve([]) };
    const promise = retrieve(untouchedDb, empty, QUERY);
    await expect(promise).rejects.toBeInstanceOf(EmbeddingError);
    await expect(promise).rejects.toThrow('Embedding provider returned no vector');
    await expect(promise).rejects.not.toThrow(QUERY);
  });
});
