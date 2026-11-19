import { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateEnv } from '../config/env.js';
import * as schema from './schema.js';
import { assertSeedAllowed, seed, seedErrorMessage } from './seed.js';

// Same as drizzle.config.ts: loadEnvFile never overrides vars already set in the process.
if (existsSync('.env')) process.loadEnvFile('.env');

try {
  const env = validateEnv(process.env);
  // Guard first: no Pool (so no connection) exists until this passes.
  assertSeedAllowed({
    DATABASE_URL: env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV, // validateEnv strips it
    SEED_ALLOWED_HOST: process.env.SEED_ALLOWED_HOST,
  });
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const counts = await seed(drizzle({ client: pool, schema }));
    for (const [table, n] of Object.entries(counts)) console.log(`${table}: inserted ${n}`);
  } finally {
    await pool.end();
  }
} catch (err) {
  // Filtered message only: no stack or driver text, which could carry connection details.
  console.error(seedErrorMessage(err));
  process.exitCode = 1;
}
