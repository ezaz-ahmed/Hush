import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateEnv } from '../config/env.js';
import * as schema from '../database/schema.js';
import { ingest, ingestErrorMessage } from './ingest.js';

// Same as drizzle.config.ts: loadEnvFile never overrides vars already set in the process.
if (existsSync('.env')) process.loadEnvFile('.env');

// No production guard: ingest only upserts our own committed content, safe to run anywhere.
try {
  const env = validateEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const sources = await ingest(drizzle({ client: pool, schema }), repoRoot);
    for (const source of sources) console.log(`upserted ${source}`);
    console.log(`ingested ${sources.length} documents`);
  } finally {
    await pool.end();
  }
} catch (err) {
  // Filtered message only: no stack or driver text, which could carry connection details.
  console.error(ingestErrorMessage(err));
  process.exitCode = 1;
}
