import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chunks, documents } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import {
  DEFAULT_MIN_SCORE,
  DEFAULT_TOP_K,
  MAX_TOP_K,
  retrieve,
  type RetrieveOptions,
} from './retrieve.js';

const HAIR = 'hair loss treatment';
const WEIGHT = 'weight loss medication programme';
const HOURS = 'clinic opening hours';

describe('retrieve (real Postgres)', () => {
  let testDb: TestDb;
  const fake = new FakeEmbeddingProvider();

  const cosine = async (a: string, b: string) => {
    const [va, vb] = await fake.embed([a, b], 'query');
    return (va ?? []).reduce((s, x, i) => s + x * (vb?.[i] ?? 0), 0);
  };

  /** Inserts one document per call with the given chunk texts; returns ids in text order. */
  const seed = async (
    source: string,
    texts: string[],
    extra: { url?: string; headingPath?: string[]; ids?: string[] } = {},
  ) => {
    const [doc] = await testDb.db
      .insert(documents)
      .values({
        source,
        title: `Title ${source}`,
        license: 'LicenseRef-Hush-Original',
        url: extra.url ?? null,
        contentHash: 'h',
      })
      .returning();
    if (!doc) throw new Error('no doc');
    const vectors = await fake.embed(texts, 'document');
    const rows = await testDb.db
      .insert(chunks)
      .values(
        texts.map((text, i) => ({
          ...(extra.ids?.[i] ? { id: extra.ids[i] } : {}),
          documentId: doc.id,
          text,
          headingPath: extra.headingPath ?? ['H1'],
          embedding: vectors[i] ?? [],
        })),
      )
      .returning();
    return { doc, ids: rows.map((r) => r.id) }; // RETURNING keeps insert order
  };

  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await testDb.db.delete(documents); // cascades to chunks
  });

  const run = (q: string, o?: RetrieveOptions, e = new FakeEmbeddingProvider()) =>
    retrieve(testDb.db, e, q, o);

  it('returns [] for an empty table', async () => {
    expect(await run('hair loss', { minScore: -1 })).toEqual([]);
  });

  it('ranks by cosine, with numeric scores matching the JS value', async () => {
    await seed('a.md', [HOURS, WEIGHT, HAIR]);
    const res = await run('hair loss', { minScore: -1 });
    const expected = await Promise.all(
      [HOURS, WEIGHT, HAIR].map(async (text) => ({ text, score: await cosine('hair loss', text) })),
    );
    expected.sort((a, b) => b.score - a.score);
    expect(res.map((r) => r.text)).toEqual(expected.map((e) => e.text));
    expect(res[0]?.text).toBe(HAIR);
    res.forEach((r, i) => {
      expect(typeof r.score).toBe('number');
      expect(Math.abs(r.score - (expected[i]?.score ?? NaN))).toBeLessThan(1e-6);
    });
  });

  it('topK limits results to the best ones; default caps at DEFAULT_TOP_K', async () => {
    await seed('a.md', [
      'hair loss one',
      'hair loss two words',
      'hair loss three more words',
      'hair loss four more words here',
      'hair loss five more words here too',
      'hair loss six more words here too ok',
    ]);
    const top2 = await run('hair loss', { topK: 2, minScore: -1 });
    expect(top2).toHaveLength(2);
    const all = await run('hair loss', { topK: MAX_TOP_K, minScore: -1 });
    expect(top2.map((r) => r.chunkId)).toEqual(all.slice(0, 2).map((r) => r.chunkId));
    expect(await run('hair loss', { minScore: -1 })).toHaveLength(DEFAULT_TOP_K);
  });

  it('minScore filters, including exactly at the threshold', async () => {
    await seed('a.md', [HAIR, WEIGHT]);
    const hair = await cosine('hair loss', HAIR);
    const weight = await cosine('hair loss', WEIGHT);
    expect(hair).toBeGreaterThan(weight);
    const mid = (hair + weight) / 2;
    expect((await run('hair loss', { minScore: mid })).map((r) => r.text)).toEqual([HAIR]);
    expect(await run('hair loss', { minScore: 1 })).toEqual([]);
  });

  it('includes a chunk scoring exactly the threshold (identical text, minScore 1)', async () => {
    await seed('a.md', [HAIR]);
    const res = await run(HAIR, { minScore: 1 });
    expect(res).toHaveLength(1);
    expect(res[0]?.score).toBeCloseTo(1, 6);
  });

  it('returns document metadata joined to each chunk', async () => {
    const a = await seed('a.md', [HAIR], {
      url: 'https://example.com/a',
      headingPath: ['A', 'a1'],
    });
    const b = await seed('b.md', [HOURS], { headingPath: ['B'] });
    const res = await run('hair loss clinic hours', { minScore: -1 });
    expect(res).toHaveLength(2);
    const byId = new Map(res.map((r) => [r.chunkId, r]));
    expect(byId.get(a.ids[0] ?? '')).toMatchObject({
      text: HAIR,
      headingPath: ['A', 'a1'],
      documentId: a.doc.id,
      source: 'a.md',
      title: 'Title a.md',
      license: 'LicenseRef-Hush-Original',
      url: 'https://example.com/a',
    });
    expect(byId.get(b.ids[0] ?? '')).toMatchObject({
      text: HOURS,
      headingPath: ['B'],
      documentId: b.doc.id,
      source: 'b.md',
      url: null,
    });
  });

  it('orders identical-score chunks by chunk id, repeatably', async () => {
    // inserted in descending id order so a missing chunks.id tie-break is detectable
    const ids = [
      'ffffffff-0000-4000-8000-000000000000',
      '80000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
    ];
    await seed('a.md', [HAIR, HAIR, HAIR], { ids });
    for (let i = 0; i < 3; i++) {
      const res = await run(HAIR, { minScore: -1 });
      expect(res.map((r) => r.chunkId)).toEqual([...ids].reverse());
    }
  });

  it('applies DEFAULT_MIN_SCORE when no options are given', async () => {
    await seed('a.md', [HAIR, HOURS]);
    // unrelated text scores ~0.29 under the fake embedder (shared bias only)
    expect(await cosine('hair loss', HOURS)).toBeLessThan(DEFAULT_MIN_SCORE);
    const res = await run('hair loss');
    expect(res.map((r) => r.text)).toEqual([HAIR]);
    expect(res).toEqual(
      await run('hair loss', { minScore: DEFAULT_MIN_SCORE, topK: DEFAULT_TOP_K }),
    );
    expect(await run('hair loss', { minScore: -1 })).toHaveLength(2);
  });

  it('makes exactly one embed call with ([query], "query")', async () => {
    await seed('a.md', [HAIR]);
    const e = new FakeEmbeddingProvider();
    await run('hair loss', undefined, e);
    expect(e.calls).toEqual([{ texts: ['hair loss'], inputType: 'query' }]);
  });
});
