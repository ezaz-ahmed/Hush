import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../config/env.js';
import { DB, DatabaseModule, type Db } from './database.module.js';

const compile = () =>
  Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule],
  }).compile();

describe('DatabaseModule', () => {
  it('provides a drizzle instance backed by a pg Pool using DATABASE_URL', async () => {
    const moduleRef = await compile();
    const db = moduleRef.get<Db>(DB);

    expect(db.$client).toBeInstanceOf(Pool);
    expect(db.$client.options.connectionString).toBe(process.env.DATABASE_URL);

    await moduleRef.close();
  });

  it('ends the pool exactly once on shutdown', async () => {
    const moduleRef = await compile();
    const end = vi.spyOn(moduleRef.get<Db>(DB).$client, 'end');

    await moduleRef.close();

    expect(end).toHaveBeenCalledTimes(1);
  });
});
