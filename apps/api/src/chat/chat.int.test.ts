import type { AddressInfo } from 'node:net';
import { ConfigModule } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { asc, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEventSchema, validationErrorSchema, type ChatEvent } from '@hush/shared';
import { DB, type Db } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import { chunks, conversations, documents, messages, users } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { LlmError, type LlmProvider, type LlmRequest } from '../llm/llm-provider.js';
import { MockLlmProvider } from '../llm/mock-llm-provider.js';
import { NO_ANSWER_TEXT } from '../prompts/no-answer.js';
import { ChatModule } from './chat.module.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './chat.tokens.js';
import { TestUserGuard } from './testing/test-user.guard.js';

// FakeEmbeddingProvider only passes the retrieval threshold when chunk text equals the query.
const QUESTION = 'what is the clinic opening hours marker-7f3a';

const parseSse = (text: string): ChatEvent[] =>
  text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split('\n');
      const type = lines[0]?.replace('event: ', '');
      const event = chatEventSchema.parse(JSON.parse(lines[1]?.replace('data: ', '') ?? ''));
      expect(event.type).toBe(type);
      return event;
    });

describe('POST /chat (real Postgres, real Fastify)', () => {
  let testDb: TestDb;
  let app: NestFastifyApplication;
  let userId: string;
  let otherUserId: string;

  const build = async (provider: LlmProvider) => {
    // Own pool: DatabaseModule ends it on close, and testDb.stop() ends the shared one.
    const db: Db = drizzle({
      client: new Pool({ connectionString: testDb.db.$client.options.connectionString }),
      schema,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ CHAT_RATE_LIMIT_PER_USER: 1000, CHAT_RATE_LIMIT_PER_IP: 1000 })],
        }),
        ChatModule,
      ],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new FakeEmbeddingProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalGuards(new TestUserGuard());
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (_req, reply, done) => {
        reply.header('x-test', '1');
        done();
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  };

  const post = (body: unknown, user: string | undefined = userId) =>
    app.inject({
      method: 'POST',
      url: '/chat',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      payload: JSON.stringify(body),
    });
  const rows = (conversationId: string) =>
    testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

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
    userId = u[0]?.id ?? '';
    otherUserId = u[1]?.id ?? '';
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
    await build(new MockLlmProvider(['Open 9 to 5 ', '[S1].']));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('streams SSE (headers, meta/token/done) and persists both messages', async () => {
    const res = await post({ message: QUESTION });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.headers['x-test']).toBe('1'); // onRequest-hook headers survive the hijack
    const events = parseSse(res.body);
    expect(events.map((e) => e.type)).toEqual(['meta', 'token', 'token', 'done']);
    const meta = events[0];
    const done = events[3];
    expect(done).toMatchObject({ kind: 'answer', content: 'Open 9 to 5 [S1].' });
    const cid = meta?.type === 'meta' ? meta.conversationId : '';
    const stored = await rows(cid);
    expect(stored.map((r) => r.role).sort()).toEqual(['assistant', 'user']);
    expect(stored.find((r) => r.role === 'assistant')?.promptVersion).toBe('answer-v1');
  });

  it('cites in first-use order, in done and in the stored row', async () => {
    const [doc2] = await testDb.db
      .insert(documents)
      .values({
        source: 'hours2.md',
        title: 'Hours 2',
        license: 'LicenseRef-Hush-Original',
        contentHash: 'h2',
      })
      .returning();
    const [vec] = await new FakeEmbeddingProvider().embed([QUESTION], 'document');
    await testDb.db.insert(chunks).values({
      documentId: doc2?.id ?? '',
      text: QUESTION,
      headingPath: ['H1'],
      embedding: vec ?? [],
    });
    const run = async (replyParts: string[]) => {
      await app.close();
      await build(new MockLlmProvider(replyParts));
      const events = parseSse((await post({ message: QUESTION })).body);
      const done = events.at(-1);
      if (done?.type !== 'done') throw new Error('no done');
      const cid = events[0]?.type === 'meta' ? events[0].conversationId : '';
      const row = (await rows(cid)).find((r) => r.role === 'assistant');
      const doneSources = done.citations.map((c) => c.source);
      expect(row?.citations.map((c) => c.source)).toEqual(doneSources);
      return doneSources;
    };
    const forward = await run(['a [S1] ', 'b [S2]']);
    expect(forward).toHaveLength(2);
    // First-use order, not retrieval order: swapping the markers must reverse the citations.
    expect(await run(['b [S2] ', 'a [S1]'])).toEqual([...forward].reverse());
  });

  it('continues a conversation: same conversation row, two more messages', async () => {
    const first = parseSse((await post({ message: QUESTION })).body)[0];
    const cid = first?.type === 'meta' ? first.conversationId : '';
    const second = await post({ conversationId: cid, message: QUESTION });
    expect(second.statusCode).toBe(200);
    expect(await rows(cid)).toHaveLength(4);
    expect((await rows(cid)).map((r) => r.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(await testDb.db.select().from(conversations)).toHaveLength(1);
  });

  it('is 404 with identical bodies for another user and an unknown id, writing nothing', async () => {
    const [conv] = await testDb.db
      .insert(conversations)
      .values({ userId: otherUserId })
      .returning();
    const notOwned = await post({ conversationId: conv?.id, message: QUESTION });
    const unknown = await post({
      conversationId: '00000000-0000-4000-8000-000000000000',
      message: QUESTION,
    });
    expect(notOwned.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(notOwned.json()).toEqual(unknown.json());
    expect(await testDb.db.select().from(messages)).toHaveLength(0);
    expect(await testDb.db.select().from(conversations)).toHaveLength(1);
  });

  it('is 400 validationError for an invalid body, without echoing input, writing nothing', async () => {
    const res = await post({ message: '   ', extra: 'marker-7f3a' });
    expect(res.statusCode).toBe(400);
    expect(validationErrorSchema.safeParse(res.json()).success).toBe(true);
    expect(res.body).not.toContain('marker-7f3a');
    expect(await testDb.db.select().from(messages)).toHaveLength(0);
    expect(await testDb.db.select().from(conversations)).toHaveLength(0);
  });

  it('is 401 without a user', async () => {
    const res = await post({ message: QUESTION }, '');
    expect(res.statusCode).toBe(401);
    expect(await testDb.db.select().from(messages)).toHaveLength(0);
  });

  it('weak retrieval: meta then no-answer done, LLM not called', async () => {
    await app.close();
    const mock = new MockLlmProvider();
    await build(mock);
    await testDb.db.delete(chunks);
    const events = parseSse((await post({ message: QUESTION })).body);
    expect(events.map((e) => e.type)).toEqual(['meta', 'done']);
    expect(events[1]).toMatchObject({ kind: 'no_answer', content: NO_ANSWER_TEXT });
    expect(mock.calls).toEqual([]);
  });

  it('ungrounded reply: done carries the no-answer', async () => {
    await app.close();
    await build(new MockLlmProvider(['No marker here.']));
    const events = parseSse((await post({ message: QUESTION })).body);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      kind: 'no_answer',
      content: NO_ANSWER_TEXT,
    });
  });

  it('unknown marker [S9]: done is the no-answer and the stored row is the no-answer', async () => {
    await app.close();
    await build(new MockLlmProvider(['Made up [S9].']));
    const events = parseSse((await post({ message: QUESTION })).body);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      kind: 'no_answer',
      content: NO_ANSWER_TEXT,
      citations: [],
    });
    const cid = events[0]?.type === 'meta' ? events[0].conversationId : '';
    const row = (await rows(cid)).find((r) => r.role === 'assistant');
    expect(row).toMatchObject({
      content: NO_ANSWER_TEXT,
      promptVersion: 'no-answer-v1',
      citations: [],
    });
  });

  it('LLM error: error event with a code only, no assistant message', async () => {
    await app.close();
    await build(new MockLlmProvider(() => new LlmError('marker-7f3a boom')));
    const res = await post({ message: QUESTION });
    const events = parseSse(res.body);
    expect(events.map((e) => e.type)).toEqual(['meta', 'error']);
    expect(events[1]).toEqual({ type: 'error', code: 'llm_unavailable' });
    expect(res.body).not.toContain('boom');
    expect(await testDb.db.select().from(messages)).toHaveLength(1);
  });

  it('client disconnect: aborts, writes no assistant message, next request still served', async () => {
    await app.close();
    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    let aborted!: () => void;
    const sawAbort = new Promise<void>((r) => (aborted = r));
    const normal = new MockLlmProvider(['Open 9 to 5 ', '[S1].']);
    let first = true;
    // First call hangs until aborted; later calls behave normally.
    const hanging: LlmProvider = {
      model: 'hang',
      async *stream(req: LlmRequest) {
        if (!first) {
          yield* normal.stream(req);
          return;
        }
        first = false;
        yield 'partial ';
        started();
        if (!req.signal?.aborted) {
          await new Promise<void>((resolve) =>
            req.signal?.addEventListener('abort', () => resolve(), { once: true }),
          );
        }
        aborted();
        throw new LlmError('aborted');
      },
    };
    await build(hanging);
    await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/chat`;
    const ac = new AbortController();
    const headers = { 'content-type': 'application/json', 'x-test-user': userId };
    const pending = fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: QUESTION }),
      signal: ac.signal,
    }).catch(() => undefined);
    await streaming;
    ac.abort();
    await pending;
    await sawAbort;

    const [row] = await testDb.db.select().from(conversations);
    expect((await rows(row?.id ?? '')).map((r) => r.role)).toEqual(['user']);

    // The same app must still serve a full stream afterwards.
    const next = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: QUESTION }),
    });
    expect(next.status).toBe(200);
    const events = parseSse(await next.text());
    expect(events.map((e) => e.type)).toEqual(['meta', 'token', 'token', 'done']);

    // The aborted conversation still has no assistant row; the new one has both.
    expect((await rows(row?.id ?? '')).map((r) => r.role)).toEqual(['user']);
    expect(await testDb.db.select().from(conversations)).toHaveLength(2);
    expect(
      (await testDb.db.select().from(messages)).filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
  });

  it('never logs message content, also on error paths', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const spies = [
      vi.spyOn(Logger.prototype, 'log'),
      vi.spyOn(Logger.prototype, 'warn'),
      errorSpy,
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
    ];
    await post({ message: QUESTION });
    await post({ message: QUESTION + ' ', bad: 'marker-7f3a' });
    await app.close();
    await build(new MockLlmProvider(() => new TypeError('marker-7f3a leaked')));
    await post({ message: QUESTION });
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('marker-7f3a');
  });
});
