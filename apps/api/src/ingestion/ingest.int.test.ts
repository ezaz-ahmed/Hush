import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chunks, documents } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { chunkDocument } from './chunk.js';
import { ingest } from './ingest.js';
import { prepareDocument } from './prepare.js';

const md = (title: string, body = '# Hi\n\nText.', extra = '') =>
  `---\ntitle: ${title}\nlicense: LicenseRef-Hush-Original\n${extra}---\n${body}\n`;

describe('ingest (real Postgres)', () => {
  let testDb: TestDb;
  let root: string;

  const write = async (rel: string, text: string) => {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, text);
  };
  const rows = () => testDb.db.select().from(documents).orderBy(documents.source);
  const chunkRows = () => testDb.db.select().from(chunks).orderBy(chunks.documentId, chunks.text);
  const failing: EmbeddingProvider = { embed: () => Promise.reject(new Error('boom')) };
  const run = (embedder: EmbeddingProvider = new FakeEmbeddingProvider()) =>
    ingest(testDb.db, root, embedder);

  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hush-ingest-'));
    await testDb.db.delete(documents);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('upserts each file with its metadata and hash', async () => {
    await write('content/clinic/a.md', md('A'));
    await write('content/medline/b.md', md('B', '# B\n\nOther.', 'url: https://example.com/b\n'));
    await write('content/notes.txt', 'ignored');

    expect(await run()).toEqual([
      { source: 'content/clinic/a.md', status: 'added' },
      { source: 'content/medline/b.md', status: 'added' },
    ]);
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      source: 'content/clinic/a.md',
      title: 'A',
      license: 'LicenseRef-Hush-Original',
      url: null,
      contentHash: prepareDocument('content/clinic/a.md', md('A')).contentHash,
    });
    expect(r[1]).toMatchObject({ source: 'content/medline/b.md', url: 'https://example.com/b' });
  });

  it('re-ingest keeps 2 rows and updates an edited title, url, license and hash', async () => {
    await write('content/a.md', md('A'));
    await write('content/b.md', md('B'));
    await run();
    const before = await rows();

    await run();
    expect(await rows()).toEqual(before);

    await write(
      'content/a.md',
      md('A2', '# Hi\n\nText.', 'url: https://example.com/a2\n').replace(
        'LicenseRef-Hush-Original',
        'LicenseRef-PublicDomain-USGov',
      ),
    );
    await run();
    const after = await rows();
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({
      id: before[0]?.id,
      title: 'A2',
      url: 'https://example.com/a2',
      license: 'LicenseRef-PublicDomain-USGov',
    });
    expect(after[0]?.contentHash).not.toBe(before[0]?.contentHash);
    expect(after[1]).toEqual(before[1]);
  });

  it('writes nothing when one file is invalid', async () => {
    await write('content/a.md', md('A'));
    await write('content/z.md', 'no frontmatter');

    await expect(run()).rejects.toThrow(/^content\/z\.md: /);
    const [n] = await testDb.db.select({ n: count() }).from(documents);
    expect(n?.n).toBe(0);
  });

  it('throws and writes nothing when there are no markdown files', async () => {
    await mkdir(join(root, 'content'), { recursive: true });

    await expect(run()).rejects.toThrow(/^content\/: no markdown files found/);
    const [n] = await testDb.db.select({ n: count() }).from(documents);
    expect(n?.n).toBe(0);
  });

  it('first ingest writes chunks with text, heading path and the fake vector in one embed call', async () => {
    const body = '# A\n\nIntro.\n\n## Sub\n\nDetail.';
    await write('content/a.md', md('A', body));
    await write('content/b.md', md('B', '# B\n\nOther.'));
    const fake = new FakeEmbeddingProvider();

    await run(fake);

    const docs = await rows();
    const cr = await chunkRows();
    const expected = docs.flatMap((d) =>
      chunkDocument(d.source === 'content/a.md' ? body : '# B\n\nOther.').map((c) => ({
        ...c,
        documentId: d.id,
      })),
    );
    expect(cr).toHaveLength(expected.length);
    for (const e of expected) {
      const row = cr.find((r) => r.documentId === e.documentId && r.text === e.text);
      expect(row?.headingPath).toEqual(e.headingPath);
      const [want] = await new FakeEmbeddingProvider().embed([e.text], 'document');
      // pgvector stores float4, so compare with a tolerance.
      expect(row).toBeDefined();
      row?.embedding?.forEach((x, k) => expect(x).toBeCloseTo(want?.[k] ?? NaN, 5));
      expect(row?.embedding).toHaveLength(want?.length ?? -1);
    }
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.inputType).toBe('document');
  });

  it('re-running with nothing changed duplicates nothing and makes no embed call', async () => {
    await write('content/a.md', md('A'));
    await write('content/b.md', md('B'));
    await run();
    const docsBefore = await rows();
    const chunksBefore = await chunkRows();
    const fake = new FakeEmbeddingProvider();

    const result = await run(fake);

    expect(result.map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(await rows()).toEqual(docsBefore);
    expect(await chunkRows()).toEqual(chunksBefore);
    expect(fake.calls).toHaveLength(0);
  });

  it('a changed body keeps the doc id, replaces its chunks and leaves the other doc alone', async () => {
    await write('content/a.md', md('A'));
    await write('content/b.md', md('B'));
    await run();
    const [a, b] = await rows();
    const oldA = await testDb.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, a?.id ?? ''))
      .orderBy(chunks.text);
    const bBefore = await testDb.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, b?.id ?? ''))
      .orderBy(chunks.text);
    const newBody = '# Hi\n\nBrand new text.';
    await write('content/a.md', md('A', newBody));
    const fake = new FakeEmbeddingProvider();

    const result = await run(fake);

    expect(result.map((r) => r.status)).toEqual(['changed', 'unchanged']);
    const [a2] = await rows();
    expect(a2?.id).toBe(a?.id);
    expect(a2?.contentHash).not.toBe(a?.contentHash);
    const newA = await testDb.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, a?.id ?? ''))
      .orderBy(chunks.text);
    expect(newA.map((c) => c.text)).toEqual(chunkDocument(newBody).map((c) => c.text));
    const oldIds = new Set(oldA.map((c) => c.id));
    expect(newA.some((c) => oldIds.has(c.id))).toBe(false);
    expect(
      await testDb.db
        .select()
        .from(chunks)
        .where(eq(chunks.documentId, b?.id ?? ''))
        .orderBy(chunks.text),
    ).toEqual(bBefore);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.texts).toEqual(chunkDocument(newBody).map((c) => c.text));
  });

  it('a title-only change counts as changed', async () => {
    await write('content/a.md', md('A'));
    await run();
    const idsBefore = (await chunkRows()).map((c) => c.id);
    await write('content/a.md', md('A renamed'));

    expect(await run()).toEqual([{ source: 'content/a.md', status: 'changed' }]);
    const idsAfter = (await chunkRows()).map((c) => c.id);
    expect(idsAfter).toHaveLength(idsBefore.length);
    expect(idsAfter.some((id) => idsBefore.includes(id))).toBe(false);
  });

  it('a row with a stale hash and no chunks becomes changed and gets chunks', async () => {
    await write('content/a.md', md('A'));
    await testDb.db.insert(documents).values({
      source: 'content/a.md',
      title: 'A',
      license: 'LicenseRef-Hush-Original',
      contentHash: 'old',
    });

    expect(await run()).toEqual([{ source: 'content/a.md', status: 'changed' }]);
    expect((await chunkRows()).length).toBeGreaterThan(0);
  });

  it('deletes the document and chunks of a removed file', async () => {
    await write('content/a.md', md('A'));
    await write('content/b.md', md('B'));
    await run();
    const [, b] = await rows();
    const bChunks = await testDb.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, b?.id ?? ''))
      .orderBy(chunks.text);
    await rm(join(root, 'content/a.md'));

    expect(await run()).toEqual([
      { source: 'content/a.md', status: 'removed' },
      { source: 'content/b.md', status: 'unchanged' },
    ]);
    expect(await rows()).toEqual([b]);
    expect(await chunkRows()).toEqual(bChunks);
  });

  it('ingests content/fixtures/ when excludeFixtures is off', async () => {
    await write('content/a.md', md('A'));
    await write('content/fixtures/evil.md', md('Evil'));

    expect(
      await ingest(testDb.db, root, new FakeEmbeddingProvider(), { excludeFixtures: false }),
    ).toEqual([
      { source: 'content/a.md', status: 'added' },
      { source: 'content/fixtures/evil.md', status: 'added' },
    ]);
  });

  it('skips content/fixtures/ when excludeFixtures is on, deleting an existing fixture row', async () => {
    await write('content/a.md', md('A'));
    await write('content/fixtures/evil.md', md('Evil'));
    await run(); // fixture already in the DB, as in a prod DB ingested before this guard
    const [a] = await rows();
    const aChunks = await chunkRows().then((all) => all.filter((c) => c.documentId === a?.id));

    expect(
      await ingest(testDb.db, root, new FakeEmbeddingProvider(), { excludeFixtures: true }),
    ).toEqual([
      { source: 'content/a.md', status: 'unchanged' },
      { source: 'content/fixtures/evil.md', status: 'removed' },
    ]);
    expect(await rows()).toEqual([a]);
    expect(await chunkRows()).toEqual(aChunks);
  });

  it('writes nothing when embedding fails, keeping old hash and chunks', async () => {
    await write('content/a.md', md('A')); // empty-DB case first
    await expect(run(failing)).rejects.toThrow('boom');
    expect((await rows()).length).toBe(0);

    await run();
    const docsBefore = await rows();
    const chunksBefore = await chunkRows();
    await write('content/a.md', md('A', '# Hi\n\nEdited.'));

    await expect(run(failing)).rejects.toThrow('boom');
    expect(await rows()).toEqual(docsBefore);
    expect(await chunkRows()).toEqual(chunksBefore);
  });

  it('throws and writes nothing for a document with no chunks', async () => {
    await write('content/a.md', md('A'));
    await write('content/x.md', md('X', '# Title'));

    await expect(run()).rejects.toThrow('content/x.md: no chunks');
    expect((await rows()).length).toBe(0);
    expect((await chunkRows()).length).toBe(0);
  });

  it('rejects and writes nothing when the provider returns too few vectors', async () => {
    await write('content/a.md', md('A'));
    await write('content/b.md', md('B'));
    const short: EmbeddingProvider = {
      embed: async (texts) => texts.slice(1).map(() => [0, 0, 0]),
    };

    await expect(run(short)).rejects.toThrow(
      new EmbeddingError('embedding returned 1 vectors for 2 texts'),
    );
    expect((await rows()).length).toBe(0);
    expect((await chunkRows()).length).toBe(0);
  });
});
