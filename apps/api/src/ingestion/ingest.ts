import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../database/database.module.js';
import { chunks, documents } from '../database/schema.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { chunkDocument } from './chunk.js';
import { prepareDocument, type PreparedDocument } from './prepare.js';

export type IngestStatus = 'added' | 'changed' | 'unchanged' | 'removed';

/**
 * Syncs content/**.md into documents + chunks. `excludeFixtures` skips content/fixtures/ (set in production). Unchanged hashes are skipped; changed or new
 * documents are re-chunked and re-embedded; documents whose file is gone are deleted.
 * All-or-nothing: embedding happens before the single write transaction.
 */
export async function ingest(
  db: Db,
  repoRoot: string,
  embedder: EmbeddingProvider,
  { excludeFixtures = false }: { excludeFixtures?: boolean } = {},
): Promise<{ source: string; status: IngestStatus }[]> {
  const files = (await readdir(join(repoRoot, 'content'), { recursive: true }))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replaceAll('\\', '/'))
    // Excluded fixtures count as gone, so an already-ingested fixture row is deleted as removed.
    .filter((f) => !(excludeFixtures && f.startsWith('fixtures/')))
    .sort();

  if (files.length === 0) throw new Error('content/: no markdown files found');

  // Prepare everything first so one bad file writes nothing.
  const prepared: PreparedDocument[] = [];
  for (const f of files) {
    const source = `content/${f}`;
    prepared.push(prepareDocument(source, await readFile(join(repoRoot, source), 'utf8')));
  }

  const stored = new Map(
    (
      await db.select({ source: documents.source, hash: documents.contentHash }).from(documents)
    ).map((r) => [r.source, r.hash]),
  );
  const results: { source: string; status: IngestStatus }[] = prepared.map((d) => ({
    source: d.source,
    status: !stored.has(d.source)
      ? 'added'
      : stored.get(d.source) === d.contentHash
        ? 'unchanged'
        : 'changed',
  }));
  const present = new Set(prepared.map((d) => d.source));
  const removed = [...stored.keys()].filter((s) => !present.has(s));
  for (const source of removed) results.push({ source, status: 'removed' });

  const todo = prepared
    .filter((d) => stored.get(d.source) !== d.contentHash)
    .map((doc) => {
      const docChunks = chunkDocument(doc.body);
      if (docChunks.length === 0) throw new Error(`${doc.source}: no chunks`);
      return { doc, docChunks };
    });

  // One embed call, all before the transaction so no network call holds locks.
  const texts = todo.flatMap((t) => t.docChunks.map((c) => c.text));
  const vectors = texts.length > 0 ? await embedder.embed(texts, 'document') : [];
  if (vectors.length !== texts.length) {
    throw new EmbeddingError(
      `embedding returned ${vectors.length} vectors for ${texts.length} texts`,
    );
  }

  await db.transaction(async (tx) => {
    let offset = 0;
    for (const { doc, docChunks } of todo) {
      const { source, title, license, url, contentHash } = doc;
      const [row] = await tx
        .insert(documents)
        .values({ source, title, license, url, contentHash })
        .onConflictDoUpdate({ target: documents.source, set: { title, license, url, contentHash } })
        .returning({ id: documents.id });
      if (!row) throw new Error(`${source}: upsert returned no row`);
      const documentId = row.id;
      const docVectors = vectors.slice(offset, offset + docChunks.length);
      offset += docChunks.length;
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
      await tx.insert(chunks).values(
        docChunks.map((c, k) => ({
          documentId,
          text: c.text,
          headingPath: c.headingPath,
          embedding: docVectors[k] as number[], // length checked above
        })),
      );
    }
    if (removed.length > 0) await tx.delete(documents).where(inArray(documents.source, removed));
  });
  return results.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/** Safe CLI error text: only our own messages pass; pg errors can carry host or username. */
export function ingestErrorMessage(err: unknown): string {
  if (err instanceof EmbeddingError) return err.message;
  if (err instanceof Error && /^(content\/|Invalid env:)/.test(err.message)) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `ingest failed ${code}` : 'ingest failed';
}
