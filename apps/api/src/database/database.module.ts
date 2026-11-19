import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Env } from '../config/env.js';
import * as schema from './schema.js';

const logger = new Logger('Database');

export const DB = Symbol('DB');
// drizzle() returns NodePgDatabase & { $client }, but the class alone has no $client.
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db => {
        const pool = new Pool({ connectionString: config.get('DATABASE_URL', { infer: true }) });
        // Neon closes idle connections on suspend; an unhandled pool 'error' would crash the process.
        // Log the code only: messages can carry host or query details (CLAUDE.md rule 2).
        pool.on('error', (err: Error & { code?: string }) =>
          logger.error(`idle pg client error: ${err.code ?? 'unknown'}`),
        );
        return drizzle({ client: pool, schema });
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
