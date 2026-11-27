import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conversations, messages, users, type Citation } from '../database/schema.js';
import { startTestDb, type TestDb } from '../database/testing/test-db.js';
import { MessageRepository } from './message.repository.js';

describe('MessageRepository (real Postgres)', () => {
  let testDb: TestDb;
  let repo: MessageRepository;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    repo = new MessageRepository(testDb.db);
  });
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await testDb.db.delete(users); // cascades to conversations and messages
    const rows = await testDb.db.insert(users).values([{}, {}]).returning();
    userId = rows[0]?.id ?? '';
    otherUserId = rows[1]?.id ?? '';
  });

  it('creates a conversation owned by the user and finds it', async () => {
    const id = await repo.createConversation(userId);
    expect(await repo.findOwnedConversation(id, userId)).toBe(id);
    const [row] = await testDb.db.select().from(conversations).where(eq(conversations.id, id));
    expect(row?.userId).toBe(userId);
  });

  it('returns null for a conversation owned by another user', async () => {
    const id = await repo.createConversation(userId);
    expect(await repo.findOwnedConversation(id, otherUserId)).toBeNull();
  });

  it('returns null for an unknown conversation id', async () => {
    expect(
      await repo.findOwnedConversation('00000000-0000-4000-8000-000000000000', userId),
    ).toBeNull();
  });

  it('stores a user message with no prompt version or citations', async () => {
    const conversationId = await repo.createConversation(userId);
    const id = await repo.insertUserMessage(conversationId, 'hello');
    const [row] = await testDb.db.select().from(messages).where(eq(messages.id, id));
    expect(row).toMatchObject({
      conversationId,
      role: 'user',
      content: 'hello',
      citations: [],
      promptVersion: null,
      guardrailDecision: null,
    });
  });

  it('stores an assistant message with citations and prompt version', async () => {
    const conversationId = await repo.createConversation(userId);
    const citations: Citation[] = [{ chunkId: 'c1', documentId: 'd1', source: 'a.md' }];
    const id = await repo.insertAssistantMessage({
      conversationId,
      content: 'answer [S1]',
      citations,
      promptVersion: 'answer-v1',
    });
    const [row] = await testDb.db.select().from(messages).where(eq(messages.id, id));
    expect(row).toMatchObject({
      role: 'assistant',
      content: 'answer [S1]',
      citations,
      promptVersion: 'answer-v1',
    });
  });

  it('rejects an assistant message without a prompt version (DB check)', async () => {
    const conversationId = await repo.createConversation(userId);
    await expect(
      repo.insertAssistantMessage({
        conversationId,
        content: 'x',
        citations: [],
        promptVersion: '',
      }),
    ).resolves.toBeTypeOf('string'); // empty string is still NOT NULL; the DB check is on NULL
    await expect(
      repo.insertAssistantMessage({
        conversationId,
        content: 'x',
        citations: [],
        // @ts-expect-error deliberately bypass the type to hit the DB check
        promptVersion: null,
      }),
    ).rejects.toThrow();
  });

  it('keeps insertion order by createdAt', async () => {
    const conversationId = await repo.createConversation(userId);
    const a = await repo.insertUserMessage(conversationId, 'q');
    const b = await repo.insertAssistantMessage({
      conversationId,
      content: 'a',
      citations: [],
      promptVersion: 'answer-v1',
    });
    const c = await repo.insertUserMessage(conversationId, 'q2');
    const rows = await testDb.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    expect(rows.map((r) => r.id)).toEqual([a, b, c]);
  });
});
