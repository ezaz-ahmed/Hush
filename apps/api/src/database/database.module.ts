import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Env } from '../config/env.js';
import * as schema from './schema.js';

export const DB = Symbol('DB');
// drizzle() returns NodePgDatabase & { $client }, but the class alone has no $client.
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db =>
        drizzle({
          client: new Pool({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
          schema,
        }),
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
