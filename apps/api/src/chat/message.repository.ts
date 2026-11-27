import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../database/database.module.js';
import { conversations, messages, type Citation } from '../database/schema.js';

/**
 * The only chat code that touches `conversations` and `messages`.
 * The stored user text is the redacted text (#40). Plaintext at rest until #45,
 * which adds field-level encryption here. Never log content.
 */
@Injectable()
export class MessageRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createConversation(userId: string): Promise<string> {
    const [row] = await this.db
      .insert(conversations)
      .values({ userId })
      .returning({ id: conversations.id });
    return required(row).id;
  }

  /** Returns the id, or null if the conversation is absent or owned by someone else. */
  async findOwnedConversation(id: string, userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    return row?.id ?? null;
  }

  async insertUserMessage(conversationId: string, content: string): Promise<string> {
    const [row] = await this.db
      .insert(messages)
      .values({ conversationId, role: 'user', content })
      .returning({ id: messages.id });
    return required(row).id;
  }

  async insertAssistantMessage(input: {
    conversationId: string;
    content: string;
    citations: Citation[];
    promptVersion: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(messages)
      .values({ ...input, role: 'assistant' })
      .returning({ id: messages.id });
    return required(row).id;
  }
}

// INSERT ... RETURNING always yields a row; this narrows the type without a bare `!`.
function required<T>(row: T | undefined): T {
  if (!row) throw new Error('insert returned no row');
  return row;
}
