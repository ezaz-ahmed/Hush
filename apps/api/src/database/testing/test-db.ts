import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { Db } from '../database.module.js';
import * as schema from '../schema.js';

// Keep in sync with the image in the root docker-compose.yml.
export const PGVECTOR_IMAGE = 'pgvector/pgvector:0.8.7-pg18';

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export interface TestDb {
  db: Db; // db.$client is the pg Pool
  /** Ends the pool, then stops the container. */
  stop(): Promise<void>;
}

// shortcut: one container per test file (a few seconds each), move to a Vitest globalSetup shared container when integration files multiply.
/** Boots a throwaway pgvector Postgres, applies all migrations in apps/api/drizzle, returns a client. */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer(PGVECTOR_IMAGE).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db: Db = drizzle({ client: pool, schema });
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    await Promise.allSettled([pool.end(), container.stop()]);
    throw err;
  }
  return {
    db,
    stop: async () => {
      try {
        await pool.end();
      } finally {
        await container.stop();
      }
    },
  };
}
