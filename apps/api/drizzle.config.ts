import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not load .env; process env wins over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

// generate only diffs schema files; fail fast naming the var for migrate/studio (drizzle-kit's own error doesn't).
const url = process.env.DATABASE_URL_UNPOOLED ?? '';
if (!url && !process.argv.includes('generate'))
  throw new Error('Missing env: DATABASE_URL_UNPOOLED');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  // Direct (unpooled) URL: migrations need a session, not PgBouncer transaction mode.
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
