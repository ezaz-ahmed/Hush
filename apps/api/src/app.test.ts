import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';

describe('app', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  const inject = (url: string, headers: Record<string, string> = {}) =>
    app.getHttpAdapter().getInstance().inject({ method: 'GET', url, headers });

  it('GET /health returns ok for the api', async () => {
    const res = await inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'api' });
  });

  it('sends no CORS header, even to a foreign origin', async () => {
    const res = await inject('/health', { origin: 'http://evil.example' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /nope returns 404', async () => {
    expect((await inject('/nope')).statusCode).toBe(404);
  });
});
