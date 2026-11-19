import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../database/database.module.js';
import { documents } from '../database/schema.js';
import { prepareDocument, type PreparedDocument } from './prepare.js';

/** Upserts every content/**.md document by source; returns the sources. All-or-nothing. */
export async function ingest(db: Db, repoRoot: string): Promise<string[]> {
  const files = (await readdir(join(repoRoot, 'content'), { recursive: true }))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replaceAll('\\', '/'))
    .sort();

  if (files.length === 0) throw new Error('content/: no markdown files found');

  // Prepare everything first so one bad file writes nothing.
  const prepared: PreparedDocument[] = [];
  for (const f of files) {
    const source = `content/${f}`;
    prepared.push(prepareDocument(source, await readFile(join(repoRoot, source), 'utf8')));
  }

  // Prepare-first already means invalid files write nothing; the transaction is defence in depth
  // for a DB write failing mid-run (untested).
  await db.transaction(async (tx) => {
    for (const { source, title, license, url, contentHash } of prepared) {
      await tx
        .insert(documents)
        .values({ source, title, license, url, contentHash })
        .onConflictDoUpdate({
          target: documents.source,
          set: { title, license, url, contentHash },
        });
    }
  });
  return prepared.map((d) => d.source);
}

/** Safe CLI error text: only our own messages pass; pg errors can carry host or username. */
export function ingestErrorMessage(err: unknown): string {
  if (err instanceof Error && /^(content\/|Invalid env:)/.test(err.message)) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `ingest failed ${code}` : 'ingest failed';
}
