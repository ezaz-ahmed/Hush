import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { count } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
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

    expect(await ingest(testDb.db, root)).toEqual(['content/clinic/a.md', 'content/medline/b.md']);
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
    await ingest(testDb.db, root);
    const before = await rows();

    await ingest(testDb.db, root);
    expect(await rows()).toEqual(before);

    await write(
      'content/a.md',
      md('A2', '# Hi\n\nText.', 'url: https://example.com/a2\n').replace(
        'LicenseRef-Hush-Original',
        'LicenseRef-PublicDomain-USGov',
      ),
    );
    await ingest(testDb.db, root);
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

    await expect(ingest(testDb.db, root)).rejects.toThrow(/^content\/z\.md: /);
    const [n] = await testDb.db.select({ n: count() }).from(documents);
    expect(n?.n).toBe(0);
  });

  it('throws and writes nothing when there are no markdown files', async () => {
    await mkdir(join(root, 'content'), { recursive: true });

    await expect(ingest(testDb.db, root)).rejects.toThrow(/^content\/: no markdown files found/);
    const [n] = await testDb.db.select({ n: count() }).from(documents);
    expect(n?.n).toBe(0);
  });
});
