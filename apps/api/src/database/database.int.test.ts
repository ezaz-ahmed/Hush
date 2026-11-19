import { readFileSync } from 'node:fs';
import { cosineDistance, asc, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from './seed.js';
import { chunks, documents, users } from './schema.js';
import { startTestDb, type TestDb } from './testing/test-db.js';

const journal = JSON.parse(
  readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: unknown[] };

// Assumes a fresh container per file; tests share state and are not retry-safe.
describe('database (real Postgres + pgvector)', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  it('applies every migration in the journal and creates the tables', async () => {
    const { db } = testDb;
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]).toEqual({ n: journal.entries.length });

    const tables = await db.execute(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_name in ('users', 'chunks', 'audit_logs')`,
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(['audit_logs', 'chunks', 'users']);
  });

  it('has the vector extension installed', async () => {
    const res = await testDb.db.execute(
      sql`select extversion from pg_extension where extname = 'vector'`,
    );
    expect(res.rows).toHaveLength(1);
  });

  it('round-trips a 1024-d embedding by cosine distance and fills tsv', async () => {
    const { db } = testDb;
    const embedding = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const [doc] = await db
      .insert(documents)
      .values({
        source: 'content/fake.md',
        title: 'Fake doc',
        license: 'fake',
        contentHash: 'fake-hash',
      })
      .returning({ id: documents.id });
    if (!doc) throw new Error('document insert returned no row');
    const orthogonal = Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1 : 0));
    await db.insert(chunks).values([
      { documentId: doc.id, text: 'fake chunk text', embedding },
      { documentId: doc.id, text: 'other words here', embedding: orthogonal },
    ]);

    const distance = cosineDistance(chunks.embedding, embedding);
    const rows = await db
      .select({ id: chunks.id, tsv: chunks.tsv, distance })
      .from(chunks)
      .where(eq(chunks.documentId, doc.id))
      .orderBy(asc(distance));

    expect(rows).toHaveLength(2);
    expect(rows[0]?.distance).toBeCloseTo(0, 6);
    expect(rows[0]?.tsv).toContain('chunk');
    expect(rows[1]?.distance).toBeCloseTo(1, 6);
  });

  it('seeds idempotently', async () => {
    const { db } = testDb;
    expect(await seed(db)).toEqual({ users: 3, consents: 2, conversations: 3 });
    expect(await seed(db)).toEqual({ users: 0, consents: 0, conversations: 0 });
    const [total] = await db.select({ n: count() }).from(users);
    expect(total?.n).toBe(3);
  });
});
