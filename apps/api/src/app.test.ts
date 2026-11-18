import { Body, Controller, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from './app.module.js';
import { ZodValidationPipe } from './common/zod-validation.pipe.js';

const echoSchema = z.object({ n: z.number() });

// Test-only route: proves the per-route pipe works through Nest and Fastify.
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }
}

describe('app', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  const inject = (url: string, headers: Record<string, string> = {}) =>
    app.getHttpAdapter().getInstance().inject({ method: 'GET', url, headers });

  const post = (payload: Record<string, unknown>) =>
    app.getHttpAdapter().getInstance().inject({ method: 'POST', url: '/echo', payload });

  it('GET /health returns ok for the api', async () => {
    const res = await inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'api' });
  });

  it('sends no CORS header, even to a foreign origin', async () => {
    const res = await inject('/health', { origin: 'http://evil.example' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('injects ConfigService with the validated PORT', () => {
    expect(app.get(ConfigService).get('PORT')).toBe(5555);
  });

  it('GET /nope returns 404', async () => {
    expect((await inject('/nope')).statusCode).toBe(404);
  });

  it('validates a routed body: good body gets 201', async () => {
    const res = await post({ n: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ n: 1 });
  });

  it('validates a routed body: bad body gets 400 without echoing the value', async () => {
    const res = await post({ n: 'jane.doe@example.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('jane.doe@example.com');
  });
});
