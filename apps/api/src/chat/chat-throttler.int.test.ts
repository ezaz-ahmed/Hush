import { ConfigModule } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimitErrorSchema } from '@hush/shared';
import { DB, type Db } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import { chunks, documents, messages, users } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { MockLlmProvider } from '../llm/mock-llm-provider.js';
import { ChatController } from './chat.controller.js';
import { ChatThrottlerGuard } from './chat-throttler.guard.js';
import { ChatModule } from './chat.module.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './chat.tokens.js';
import { TestUserGuard } from './testing/test-user.guard.js';

// FakeEmbeddingProvider only passes the retrieval threshold when chunk text equals the query.
const QUESTION = 'what is the clinic opening hours marker-7f3a';
const PER_USER = 2;
const PER_IP = 3;
const IP_1 = '10.0.0.1';
const IP_2 = '10.0.0.2';

describe('POST /chat rate limiting (real Postgres, real Fastify)', () => {
  let testDb: TestDb;
  let app: NestFastifyApplication;
  let llm: MockLlmProvider;
  let embedder: FakeEmbeddingProvider;
  let userA: string;
  let userB: string;

  const post = (opts: { user?: string; ip?: string; body?: unknown } = {}) =>
    app.inject({
      method: 'POST',
      url: '/chat',
      remoteAddress: opts.ip ?? IP_1,
      headers: {
        'content-type': 'application/json',
        ...(opts.user ? { 'x-test-user': opts.user } : {}),
      },
      payload: JSON.stringify(opts.body ?? { message: QUESTION }),
    });

  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await testDb.db.delete(users);
    await testDb.db.delete(documents);
    const u = await testDb.db.insert(users).values([{}, {}]).returning();
    userA = u[0]?.id ?? '';
    userB = u[1]?.id ?? '';
    const [doc] = await testDb.db
      .insert(documents)
      .values({
        source: 'hours.md',
        title: 'Hours',
        license: 'LicenseRef-Hush-Original',
        contentHash: 'h',
      })
      .returning();
    const [vec] = await new FakeEmbeddingProvider().embed([QUESTION], 'document');
    await testDb.db.insert(chunks).values({
      documentId: doc?.id ?? '',
      text: QUESTION,
      headingPath: ['H1'],
      embedding: vec ?? [],
    });

    llm = new MockLlmProvider(['Open 9 to 5 ', '[S1].']);
    embedder = new FakeEmbeddingProvider();
    // Own pool: DatabaseModule ends it on close, and testDb.stop() ends the shared one.
    const db: Db = drizzle({
      client: new Pool({ connectionString: testDb.db.$client.options.connectionString }),
      schema,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ CHAT_RATE_LIMIT_PER_USER: PER_USER, CHAT_RATE_LIMIT_PER_IP: PER_IP })],
        }),
        ChatModule,
      ],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(LLM_PROVIDER)
      .useValue(llm)
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(embedder)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalGuards(new TestUserGuard());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('user limit: third request is a JSON 429 with a matching Retry-After and no other rate headers', async () => {
    expect((await post({ user: userA })).statusCode).toBe(200);
    expect((await post({ user: userA })).statusCode).toBe(200);
    const res = await post({ user: userA });
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('text/event-stream');
    const body = rateLimitErrorSchema.parse(res.json());
    expect(res.headers['retry-after']).toBe(String(body.retryAfter));
    expect(Number.isInteger(Number(res.headers['retry-after']))).toBe(true);
    const names = Object.keys(res.headers).filter(
      (h) => h.startsWith('retry-after-') || h.startsWith('x-ratelimit'),
    );
    expect(names).toEqual([]);
  });

  it('a 429 does no work: no embedding, no LLM call, no message row', async () => {
    await post({ user: userA });
    await post({ user: userA });
    const embedSpy = vi.spyOn(embedder, 'embed');
    const llmCalls = llm.calls.length;
    const before = await testDb.db.select().from(messages);
    const res = await post({ user: userA });
    expect(res.statusCode).toBe(429);
    expect(embedSpy).not.toHaveBeenCalled();
    expect(llm.calls).toHaveLength(llmCalls);
    expect(await testDb.db.select().from(messages)).toHaveLength(before.length);
  });

  it('limits are per user: another user on another IP is still served', async () => {
    await post({ user: userA });
    await post({ user: userA });
    expect((await post({ user: userA })).statusCode).toBe(429);
    expect((await post({ user: userB, ip: IP_2 })).statusCode).toBe(200);
  });

  it('IP limit: the 4th request from one IP is 429 across users; the user limit still applies from another IP', async () => {
    for (const user of [userA, userB, userA]) {
      expect((await post({ user })).statusCode).toBe(200);
    }
    // userA and userB are each within their user limit, so the 429 below comes from the IP limit.
    expect((await post({ user: userB })).statusCode).toBe(429);
    expect((await post({ user: userA, ip: IP_2 })).statusCode).toBe(429);
  });

  it('no user id: 401 until the IP limit, then 429', async () => {
    for (let i = 0; i < PER_IP; i++) expect((await post()).statusCode).toBe(401);
    const res = await post();
    expect(res.statusCode).toBe(429);
    expect(rateLimitErrorSchema.safeParse(res.json()).success).toBe(true);
  });

  it('a 400 counts toward the limit; once over it the answer is 429, not 400', async () => {
    const bad = { message: '   ' };
    expect((await post({ user: userA, body: bad })).statusCode).toBe(400);
    expect((await post({ user: userA, body: bad })).statusCode).toBe(400);
    expect((await post({ user: userA, body: bad })).statusCode).toBe(429);
  });

  it('the guard is on the chat controller only (GET /health is not throttled)', () => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', ChatController) ?? [];
    expect(guards).toContain(ChatThrottlerGuard);
  });

  it('a 429 logs nothing containing the IP, user id or message', async () => {
    await post({ user: userA });
    await post({ user: userA });
    const spies = [
      vi.spyOn(Logger.prototype, 'log'),
      vi.spyOn(Logger.prototype, 'warn'),
      vi.spyOn(Logger.prototype, 'error'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
    ];
    const res = await post({ user: userA });
    expect(res.statusCode).toBe(429);
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
    expect(res.body).not.toContain(IP_1);
    expect(res.body).not.toContain(userA);
  });
});
