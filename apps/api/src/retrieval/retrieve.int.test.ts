import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chunks, documents } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { fuseRrf } from './rrf.js';
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

  describe('hybrid mode', () => {
    const hybrid = (q: string, o: RetrieveOptions = {}, e = new FakeEmbeddingProvider()) =>
      run(q, { ...o, mode: 'hybrid' }, e);
    const ids = (rows: { chunkId: string }[]) => rows.map((r) => r.chunkId);

    // Matches "treatments" only through stemming; long, so its cosine is the lowest of the pair.
    const STEMMED = 'treatment dosage guide notes here too';
    const FILLER = 'clinic';

    it('surfaces a stemming-only match that vector mode ranks last (flag differs by mode)', async () => {
      const { ids: seeded } = await seed('a.md', [FILLER, STEMMED]);
      const opts = { topK: 1, minScore: -1 };
      expect(ids(await run('treatments', opts))).toEqual([seeded[0]]);
      expect(ids(await run('treatments', { ...opts, mode: 'vector' }))).toEqual([seeded[0]]);
      expect(ids(await hybrid('treatments', opts))).toEqual([seeded[1]]);
    });

    it('orders by fuseRrf of the vector order and the full-text order', async () => {
      await seed('a.md', [
        HAIR,
        'hair',
        'hair loss',
        'hair loss clinic hours',
        'hair hair hair loss loss clinic notes',
        WEIGHT,
      ]);
      const opts = { topK: MAX_TOP_K, minScore: -1 };
      const vectorIds = ids(await run('hair loss', opts));
      const fts = await testDb.db.execute<{ id: string }>(sql`
        select id from chunks
        where tsv @@ replace(plainto_tsquery('english', ${'hair loss'})::text, ' & ', ' | ')::tsquery
        order by ts_rank(tsv, replace(plainto_tsquery('english', ${'hair loss'})::text, ' & ', ' | ')::tsquery) desc, id`);
      const ftsIds = fts.rows.map((r) => r.id);
      expect(ftsIds.length).toBeGreaterThan(0);
      const expected = fuseRrf([vectorIds, ftsIds]).map((r) => r.id);
      expect(ids(await hybrid('hair loss', opts))).toEqual(expected);
    });

    it("ranks a chunk that is rank 2 in both lists above each list's lone rank 1", async () => {
      // 'the' is a stopword: counted by the fake embedder, invisible to full-text search
      const query = 'the hair loss';
      const V = 'the'; // vector rank 1, not a full-text match
      const S = 'hair notes'; // rank 2 in both lists (one lexeme, mid cosine)
      // vector-only chunks between S and F, so F's vector rank is too low for F's double hit to beat S
      const X = [10, 11, 12].map((n) => Array(n).fill('the').join(' '));
      const F = `hair loss ${Array.from({ length: 12 }, (_, i) => `w${i}x`).join(' ')}`; // fts rank 1, lowest cosine
      const { ids: [v, sh, ...rest] = [] } = await seed('a.md', [V, S, ...X, F]);
      const f = rest[3];
      const opts = { topK: MAX_TOP_K, minScore: -1 };
      // preconditions, so the setup cannot silently degrade
      expect(ids(await run(query, opts))).toEqual([v, sh, ...rest]);
      const fts = await testDb.db.execute<{ id: string }>(sql`
        select id from chunks
        where tsv @@ replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery
        order by ts_rank(tsv, replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery) desc, id`);
      expect(fts.rows.map((r) => r.id)).toEqual([f, sh]);
      // plain rank-1 picks would give v or f; only fusion puts the shared chunk first
      const res = await hybrid(query, opts);
      expect(res).toHaveLength(6);
      expect(res[0]?.chunkId).toBe(sh);
    });

    it('full-text search ORs the query lexemes: one matching word is enough', async () => {
      // 'the' is a stopword: it lifts FILL in vector mode but never matches full-text
      const query = 'the finasteride side effects';
      const { ids: [a, fill] = [] } = await seed('a.md', ['finasteride notes', 'the the']);
      const opts = { topK: 1, minScore: -1 };
      expect(ids(await run(query, opts))).toEqual([fill]); // A is not vector top-1
      expect(ids(await hybrid(query, opts))).toEqual([a]); // A matches only 'finasteride'
    });

    it('drops a keyword match whose cosine is below minScore, as vector mode does', async () => {
      const far = `hair loss ${Array.from({ length: 40 }, (_, i) => `w${i}x`).join(' ')}`;
      const { ids: seeded } = await seed('a.md', [HAIR, far]);
      const minScore = 0.5;
      expect(await cosine('hair loss', far)).toBeLessThan(minScore);
      expect(ids(await hybrid('hair loss', { minScore }))).toEqual([seeded[0]]);
      expect(ids(await hybrid('hair loss', { minScore: -1 }))).toContain(seeded[1]);
    });

    it('returns [] when minScore is above every cosine, and whenever vector mode does', async () => {
      await seed('a.md', [HAIR, WEIGHT, HOURS]);
      expect(await hybrid('hair loss', { minScore: 1 })).toEqual([]);
      for (const q of ['hair loss', 'treatments', 'the and of', 'zzzz']) {
        const v = await run(q, { minScore: 0.6 });
        expect((await hybrid(q, { minScore: 0.6 })).length === 0).toBe(v.length === 0);
      }
      expect(await run('zzzz', { minScore: 0.6 })).toEqual([]);
      expect(await hybrid('zzzz', { minScore: 0.6 })).toEqual([]);
    });

    it('keeps score as cosine and the same metadata as vector mode', async () => {
      await seed('a.md', [HAIR, HOURS], { url: 'https://example.com/a', headingPath: ['A', 'a1'] });
      const res = await hybrid('hair loss', { minScore: -1 });
      const vec = new Map((await run('hair loss', { minScore: -1 })).map((r) => [r.chunkId, r]));
      expect(res).toHaveLength(2);
      for (const r of res) {
        const v = vec.get(r.chunkId);
        expect(r).toEqual(v);
        expect(Math.abs(r.score - (await cosine('hair loss', r.text)))).toBeLessThan(1e-6);
      }
    });

    it.each([
      `it's "hair" & loss | !x :* <-> (a)`,
      `'`,
      `"`,
      `& | ! :* <-> ( )`,
      'hair-loss',
      'the and of to',
    ])('does not throw on query %j', async (q) => {
      await seed('a.md', [HAIR, HOURS]);
      await expect(hybrid(q, { minScore: -1 })).resolves.toBeInstanceOf(Array);
    });

    it('finds a chunk through a hyphenated query', async () => {
      const { ids: seeded } = await seed('a.md', [HAIR, HOURS]);
      expect(ids(await hybrid('hair-loss', { minScore: -1 }))).toContain(seeded[0]);
    });

    it('a stopword-only query returns the vector-mode result', async () => {
      await seed('a.md', [HAIR, WEIGHT, HOURS]);
      const opts = { minScore: -1 };
      expect(await hybrid('the and of', opts)).toEqual(await run('the and of', opts));
    });

    it('orders identical chunks by chunk id, repeatably', async () => {
      const seededIds = [
        'ffffffff-0000-4000-8000-000000000000',
        '80000000-0000-4000-8000-000000000000',
        '00000000-0000-4000-8000-000000000000',
      ];
      await seed('a.md', [HAIR, HAIR, HAIR], { ids: seededIds });
      for (let i = 0; i < 3; i++) {
        expect(ids(await hybrid(HAIR, { minScore: -1 }))).toEqual([...seededIds].reverse());
      }
    });

    it('makes exactly one embed call with ([query], "query")', async () => {
      await seed('a.md', [HAIR]);
      const e = new FakeEmbeddingProvider();
      await hybrid('hair loss', undefined, e);
      expect(e.calls).toEqual([{ texts: ['hair loss'], inputType: 'query' }]);
    });

    it('topK caps results', async () => {
      await seed(
        'a.md',
        Array.from({ length: 6 }, (_, i) => `hair loss entry ${'x'.repeat(i + 1)}`),
      );
      expect(await hybrid('hair loss', { topK: 2, minScore: -1 })).toHaveLength(2);
      expect(await hybrid('hair loss', { minScore: -1 })).toHaveLength(DEFAULT_TOP_K);
    });
  });
});
