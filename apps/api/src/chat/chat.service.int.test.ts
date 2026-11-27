import { Logger, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEventSchema, type ChatEvent } from '@hush/shared';
import { chunks, conversations, documents, messages, users } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { FakeEmbeddingProvider } from '../embedding/fake-embedding-provider.js';
import { LlmError, type LlmProvider, type LlmRequest } from '../llm/llm-provider.js';
import { MockLlmProvider } from '../llm/mock-llm-provider.js';
import { ANSWER_SYSTEM_PROMPT } from '../prompts/answer-prompt.js';
import { NO_ANSWER_TEXT } from '../prompts/no-answer.js';
import { retrieve } from '../retrieval/retrieve.js';
import { ANSWER_MAX_TOKENS, ChatService } from './chat.service.js';
import { MessageRepository } from './message.repository.js';

// FakeEmbeddingProvider only passes the retrieval threshold when chunk text equals the query.
const QUESTION = 'what is the clinic opening hours marker-7f3a';

describe('ChatService (real Postgres)', () => {
  let testDb: TestDb;
  let userId: string;
  let otherUserId: string;
  let chunkId: string;
  let documentId: string;

  const make = (llm: LlmProvider, embedder: EmbeddingProvider = new FakeEmbeddingProvider()) =>
    new ChatService(testDb.db, new MessageRepository(testDb.db), llm, embedder);

  const run = async (
    svc: ChatService,
    conversationId: string,
    signal = new AbortController().signal,
  ) => {
    const events: ChatEvent[] = [];
    for await (const e of svc.handle(conversationId, QUESTION, signal)) {
      expect(chatEventSchema.safeParse(e).success).toBe(true);
      events.push(e);
    }
    return events;
  };
  const stored = (conversationId: string) =>
    testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.role));

  const seedKb = async () => {
    const [doc] = await testDb.db
      .insert(documents)
      .values({
        source: 'hours.md',
        title: 'Hours',
        license: 'LicenseRef-Hush-Original',
        contentHash: 'h',
      })
      .returning();
    if (!doc) throw new Error('no doc');
    const [vec] = await new FakeEmbeddingProvider().embed([QUESTION], 'document');
    const [chunk] = await testDb.db
      .insert(chunks)
      .values({ documentId: doc.id, text: QUESTION, headingPath: ['H1'], embedding: vec ?? [] })
      .returning();
    if (!chunk) throw new Error('no chunk');
    documentId = doc.id;
    chunkId = chunk.id;
  };

  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await testDb.db.delete(users);
    await testDb.db.delete(documents);
    const rows = await testDb.db.insert(users).values([{}, {}]).returning();
    userId = rows[0]?.id ?? '';
    otherUserId = rows[1]?.id ?? '';
    await seedKb();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('resolveConversation', () => {
    it('creates a conversation for the user when no id is given', async () => {
      const id = await make(new MockLlmProvider()).resolveConversation(userId);
      const [row] = await testDb.db.select().from(conversations).where(eq(conversations.id, id));
      expect(row?.userId).toBe(userId);
    });

    it('returns the same id for an owned conversation', async () => {
      const svc = make(new MockLlmProvider());
      const id = await svc.resolveConversation(userId);
      expect(await svc.resolveConversation(userId, id)).toBe(id);
    });

    it('throws NotFoundException for another user or an unknown id, writing nothing', async () => {
      const svc = make(new MockLlmProvider());
      const id = await svc.resolveConversation(otherUserId);
      const before = await testDb.db.select().from(conversations);
      await expect(svc.resolveConversation(userId, id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        svc.resolveConversation(userId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await testDb.db.select().from(conversations)).toHaveLength(before.length);
    });
  });

  describe('handle', () => {
    it('streams meta, tokens, done and persists the grounded answer (answer-v1 + citations)', async () => {
      const svc = make(new MockLlmProvider(['Open 9 to 5 ', '[S1].']));
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);

      expect(events.map((e) => e.type)).toEqual(['meta', 'token', 'token', 'done']);
      const [meta, , , done] = events;
      expect(meta).toMatchObject({ type: 'meta', conversationId: cid });
      expect(events.filter((e) => e.type === 'token').map((e) => e.text)).toEqual([
        'Open 9 to 5 ',
        '[S1].',
      ]);
      expect(done).toMatchObject({
        type: 'done',
        kind: 'answer',
        content: 'Open 9 to 5 [S1].',
        citations: [{ id: 'S1', chunkId, documentId, source: 'hours.md' }],
      });

      const rows = await stored(cid);
      expect(rows.map((r) => r.role).sort()).toEqual(['assistant', 'user']);
      const assistant = rows.find((r) => r.role === 'assistant');
      expect(assistant).toMatchObject({
        id: done?.type === 'done' ? done.messageId : '',
        content: 'Open 9 to 5 [S1].',
        promptVersion: 'answer-v1',
        citations: [{ chunkId, documentId, source: 'hours.md' }],
      });
      const user = rows.find((r) => r.role === 'user');
      expect(user?.content).toBe(QUESTION);
      expect(meta?.type === 'meta' && meta.userMessageId).toBe(user?.id);
    });

    it('continues a conversation: a second turn appends two more messages', async () => {
      const svc = make(new MockLlmProvider(['Yes [S1].']));
      const cid = await svc.resolveConversation(userId);
      await run(svc, cid);
      await run(svc, await svc.resolveConversation(userId, cid));
      expect(await stored(cid)).toHaveLength(4);
      expect((await stored(cid)).map((r) => r.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(await testDb.db.select().from(conversations)).toHaveLength(1);
    });

    it('weak retrieval: no LLM call, fixed no-answer persisted as no-answer-v1', async () => {
      await testDb.db.delete(chunks);
      const llm = new MockLlmProvider();
      const svc = make(llm);
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);

      expect(llm.calls).toEqual([]);
      expect(events.map((e) => e.type)).toEqual(['meta', 'done']);
      expect(events[1]).toMatchObject({
        kind: 'no_answer',
        content: NO_ANSWER_TEXT,
        citations: [],
      });
      const assistant = (await stored(cid)).find((r) => r.role === 'assistant');
      expect(assistant).toMatchObject({
        content: NO_ANSWER_TEXT,
        promptVersion: 'no-answer-v1',
        citations: [],
      });
    });

    it('weak retrieval with chunks present: none pass the threshold, no LLM call, no-answer-v1', async () => {
      const embedder = new FakeEmbeddingProvider();
      // chunk vector = negated question vector, so cosine is -1: far below any sane threshold
      const [q] = await embedder.embed([QUESTION], 'query');
      await testDb.db.update(chunks).set({ embedding: (q ?? []).map((x) => -x) });
      // precondition: the KB is non-empty yet retrieval finds nothing for QUESTION
      expect(await testDb.db.select().from(chunks)).not.toHaveLength(0);
      expect(await retrieve(testDb.db, embedder, QUESTION)).toEqual([]);

      const llm = new MockLlmProvider();
      const svc = make(llm, embedder);
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);

      expect(llm.calls).toEqual([]);
      expect(events.map((e) => e.type)).toEqual(['meta', 'done']);
      expect(events[1]).toMatchObject({
        kind: 'no_answer',
        content: NO_ANSWER_TEXT,
        citations: [],
      });
      expect(NO_ANSWER_TEXT).toMatch(/contact the clinic/i);
      const assistant = (await stored(cid)).find((r) => r.role === 'assistant');
      expect(assistant).toMatchObject({ promptVersion: 'no-answer-v1', citations: [] });
    });

    it.each([
      ['no marker', ['Open 9 to 5.']],
      ['unknown marker [S9]', ['Open 9 to 5 [S9].']],
    ])('ungrounded reply (%s): tokens streamed, then no-answer persisted', async (_n, deltas) => {
      const svc = make(new MockLlmProvider(deltas));
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);

      expect(events.map((e) => e.type)).toEqual(['meta', 'token', 'done']);
      expect(events[2]).toMatchObject({
        kind: 'no_answer',
        content: NO_ANSWER_TEXT,
        citations: [],
      });
      const assistant = (await stored(cid)).find((r) => r.role === 'assistant');
      expect(assistant).toMatchObject({ content: NO_ANSWER_TEXT, promptVersion: 'no-answer-v1' });
    });

    describe('citation failure warn', () => {
      const warnFor = async (deltas: string[]) => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const svc = make(new MockLlmProvider(deltas));
        const cid = await svc.resolveConversation(userId);
        await run(svc, cid);
        return { warn, cid };
      };

      it('no_citations: one warn with conversation id and reason only', async () => {
        const { warn, cid } = await warnFor(['Open 9 to 5.']);
        expect(warn.mock.calls).toEqual([
          [`citation check failed conversation=${cid} reason=no_citations unknown=`],
        ]);
      });

      it('unknown_ids: lists the fabricated id', async () => {
        const { warn, cid } = await warnFor(['Open 9 to 5 [S9].']);
        expect(warn.mock.calls).toEqual([
          [`citation check failed conversation=${cid} reason=unknown_ids unknown=S9`],
        ]);
      });

      it('masks a long unknown id as S? so model-emitted digits never reach the log', async () => {
        const { warn, cid } = await warnFor(['Call [S91234567].']);
        expect(warn.mock.calls).toEqual([
          [`citation check failed conversation=${cid} reason=unknown_ids unknown=S?`],
        ]);
        expect(String(warn.mock.calls[0]?.[0])).not.toContain('91234567');
      });

      it('grounded reply: no warn', async () => {
        const { warn } = await warnFor(['Open 9 to 5 [S1].']);
        expect(warn).not.toHaveBeenCalled();
      });

      it('empty retrieval no-answer: no warn', async () => {
        await testDb.db.delete(chunks);
        const { warn } = await warnFor(['unused']);
        expect(warn).not.toHaveBeenCalled();
      });

      it('caps the logged unknown ids at 10', async () => {
        const ids = Array.from({ length: 12 }, (_, i) => `S${i + 2}`);
        const { warn, cid } = await warnFor([`Open ${ids.map((id) => `[${id}]`).join(' ')}.`]);
        expect(warn.mock.calls).toEqual([
          [
            `citation check failed conversation=${cid} reason=unknown_ids unknown=${ids.slice(0, 10).join(',')}`,
          ],
        ]);
      });
    });

    it('LlmError: error llm_unavailable, user message kept, no assistant message', async () => {
      const svc = make(new MockLlmProvider(() => new LlmError('boom')));
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);
      expect(events.map((e) => e.type)).toEqual(['meta', 'error']);
      expect(events[1]).toEqual({ type: 'error', code: 'llm_unavailable' });
      expect((await stored(cid)).map((r) => r.role)).toEqual(['user']);
    });

    it('EmbeddingError: error llm_unavailable, user message kept, no assistant message', async () => {
      const failing: EmbeddingProvider = {
        embed: () => Promise.reject(new EmbeddingError('down')),
      };
      const llm = new MockLlmProvider();
      const svc = make(llm, failing);
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);
      expect(events[1]).toEqual({ type: 'error', code: 'llm_unavailable' });
      expect(llm.calls).toEqual([]);
      expect((await stored(cid)).map((r) => r.role)).toEqual(['user']);
    });

    it('other errors map to internal', async () => {
      const svc = make(new MockLlmProvider(() => new TypeError('weird')));
      const cid = await svc.resolveConversation(userId);
      const events = await run(svc, cid);
      expect(events[1]).toEqual({ type: 'error', code: 'internal' });
      expect((await stored(cid)).map((r) => r.role)).toEqual(['user']);
    });

    it('non-Error throw maps to internal', async () => {
      const throwing: LlmProvider = {
        model: 'x',
        // eslint-disable-next-line require-yield
        async *stream() {
          throw 'not an error object';
        },
      };
      const svc = make(throwing);
      const cid = await svc.resolveConversation(userId);
      expect((await run(svc, cid))[1]).toEqual({ type: 'error', code: 'internal' });
    });

    const abortAfter = async (type: ChatEvent['type'], tokenCount: number) => {
      const llm = new MockLlmProvider(Array.from({ length: tokenCount }, () => 'x [S1] '));
      const ac = new AbortController();
      const svc = make(llm);
      const cid = await svc.resolveConversation(userId);
      const types: string[] = [];
      for await (const e of svc.handle(cid, QUESTION, ac.signal)) {
        types.push(e.type);
        if (e.type === type) ac.abort();
      }
      expect((await stored(cid)).map((m) => m.role)).toEqual(['user']);
      return { types, calls: llm.calls.length };
    };

    it('abort right after meta: stops before the LLM is called', async () => {
      expect(await abortAfter('meta', 2)).toEqual({ types: ['meta'], calls: 0 });
    });

    it('abort on the last token: no done event, no assistant message', async () => {
      expect((await abortAfter('token', 1)).types).toEqual(['meta', 'token']);
    });

    it('abort mid-stream: stops, emits nothing more, persists no assistant message', async () => {
      // Waits on the signal, then throws LlmError like a real provider on abort.
      const hanging: LlmProvider = {
        model: 'hang',
        async *stream(req: LlmRequest) {
          yield 'partial ';
          await new Promise<void>((resolve) => {
            if (req.signal?.aborted) resolve();
            else req.signal?.addEventListener('abort', () => resolve());
          });
          throw new LlmError('aborted');
        },
      };
      const ac = new AbortController();
      const svc = make(hanging);
      const cid = await svc.resolveConversation(userId);
      const events: ChatEvent[] = [];
      for await (const e of svc.handle(cid, QUESTION, ac.signal)) {
        events.push(e);
        if (e.type === 'token') ac.abort();
      }
      expect(events.map((e) => e.type)).toEqual(['meta', 'token']);
      expect((await stored(cid)).map((r) => r.role)).toEqual(['user']);
    });

    it('sends the answer system prompt, the question and maxTokens 1024 to the LLM', async () => {
      const llm = new MockLlmProvider(['ok [S1]']);
      const svc = make(llm);
      await run(svc, await svc.resolveConversation(userId));
      expect(ANSWER_MAX_TOKENS).toBe(1024);
      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0]?.system).toBe(ANSWER_SYSTEM_PROMPT);
      expect(llm.calls[0]?.maxTokens).toBe(1024);
      expect(llm.calls[0]?.messages[0]?.content).toContain(QUESTION);
    });

    it('never logs message content, also on the error path', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error');
      const spies = [
        vi.spyOn(Logger.prototype, 'log'),
        vi.spyOn(Logger.prototype, 'warn'),
        errorSpy,
        vi.spyOn(Logger.prototype, 'debug'),
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'error'),
        vi.spyOn(console, 'warn'),
      ];
      for (const llm of [
        new MockLlmProvider(['fine [S1] marker-7f3a']),
        new MockLlmProvider(() => new LlmError('marker-7f3a leaked')),
        new MockLlmProvider(() => new TypeError('marker-7f3a leaked')),
      ]) {
        const svc = make(llm);
        await run(svc, await svc.resolveConversation(userId));
      }
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(errorSpy).toHaveBeenCalled();
      expect(logged).not.toContain('marker-7f3a');
    });
  });
});
