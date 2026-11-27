import { Body, Controller, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chatRequestSchema, healthStatusSchema, validationErrorSchema } from '@hush/shared';
import { z } from 'zod';
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';
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

  const inject = (url: string) => app.getHttpAdapter().getInstance().inject({ method: 'GET', url });

  const post = (payload: Record<string, unknown>) =>
    app.getHttpAdapter().getInstance().inject({ method: 'POST', url: '/echo', payload });

  it('GET /health returns ok for the api', async () => {
    const res = await inject('/health');
    expect(res.statusCode).toBe(200);
    expect(healthStatusSchema.parse(res.json())).toEqual({ ok: true, service: 'api' });
  });

  it('injects ConfigService with the validated PORT', () => {
    // The default itself is covered in env.test.ts; this only proves the validated value is wired in.
    expect(app.get(ConfigService).get('PORT')).toBe(validateEnv(process.env).PORT);
  });

  it('GET /nope returns 404', async () => {
    expect((await inject('/nope')).statusCode).toBe(404);
  });

  it('POST /chat returns 404: chat is gated until redaction (#40), consent (#41) and guardrails (#49-#51) land', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/chat',
        payload: chatRequestSchema.parse({ message: 'How long does shipping take?' }),
      });
    expect(res.statusCode).toBe(404);
  });

  it('validates a routed body: good body gets 201', async () => {
    const res = await post({ n: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ n: 1 });
  });

  it('validates a routed body: bad body gets 400 without echoing the value', async () => {
    const res = await post({ n: 'jane.doe@example.com' });
    expect(res.statusCode).toBe(400);
    expect(validationErrorSchema.parse(res.json())).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [{ path: ['n'], code: 'invalid_type' }],
    });
    expect(res.body).not.toContain('jane.doe@example.com');
  });
});

describe('startup env validation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to load the app module when PORT is invalid, naming it without the value', async () => {
    // process.env wins over a local .env in ConfigModule, so this is deterministic.
    vi.stubEnv('PORT', 'abc');
    vi.resetModules();
    // forRoot validates inside a promise Nest awaits at compile, so compile, not just import.
    const err = await import('./app.module.js')
      .then(({ AppModule: Fresh }) => Test.createTestingModule({ imports: [Fresh] }).compile())
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Invalid env: PORT');
  });

  it('refuses to load the app module when DATABASE_URL is missing, naming it without a value', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.resetModules();
    const err = await import('./app.module.js')
      .then(({ AppModule: Fresh }) => Test.createTestingModule({ imports: [Fresh] }).compile())
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Invalid env: DATABASE_URL');
  });
});
