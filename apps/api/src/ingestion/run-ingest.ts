import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateEnv } from '../config/env.js';
import { VoyageEmbeddingProvider } from '../embedding/voyage-embedding-provider.js';
import * as schema from '../database/schema.js';
import { ingest, ingestErrorMessage, type IngestStatus } from './ingest.js';

// Same as drizzle.config.ts: loadEnvFile never overrides vars already set in the process.
if (existsSync('.env')) process.loadEnvFile('.env');

// No production guard: ingest only upserts our own committed content, safe to run anywhere.
try {
  const env = validateEnv(process.env);
  if (!env.VOYAGE_API_KEY) throw new Error('Invalid env: VOYAGE_API_KEY is required for ingest');
  const embedder = new VoyageEmbeddingProvider({ apiKey: env.VOYAGE_API_KEY });
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const results = await ingest(drizzle({ client: pool, schema }), repoRoot, embedder);
    for (const { source, status } of results) console.log(`${status} ${source}`);
    const count = (s: IngestStatus) => results.filter((r) => r.status === s).length;
    console.log(
      `ingested ${results.length} documents: ${count('added')} added, ${count('changed')} changed, ${count('unchanged')} unchanged, ${count('removed')} removed`,
    );
  } finally {
    await pool.end();
  }
} catch (err) {
  // Filtered message only: no stack or driver text, which could carry connection details.
  console.error(ingestErrorMessage(err));
  process.exitCode = 1;
}
