import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export type Citation = { chunkId: string; documentId: string; source: string };

// drizzle has no built-in tsvector column.
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const messageRole = pgEnum('message_role', ['user', 'assistant']);
export const guardrailDecision = pgEnum('guardrail_decision', [
  'allowed',
  'emergency',
  'diagnosis',
  'dosage',
  'off_topic',
]);

export const documents = pgTable('documents', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // Repo-relative content path; the re-ingest key (#22).
  source: text('source').notNull().unique(),
  title: text('title').notNull(),
  license: text('license').notNull(),
  url: text('url'),
  // sha256 hex of the normalised content.
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    headingPath: text('heading_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    // Kept in sync by Postgres; the app never writes it.
    tsv: tsvector('tsv').generatedAlwaysAs(
      // Explicit return type breaks TS circular inference on the self-reference to chunks.text.
      (): ReturnType<typeof sql> => sql`to_tsvector('english', ${chunks.text})`,
    ),
  },
  (t) => [
    index('chunks_document_id_idx').on(t.documentId),
    index('chunks_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_tsv_gin_idx').using('gin', t.tsv),
  ],
);

export const conversations = pgTable('conversations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    // Ciphertext once #45 lands; write only through the repository.
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    guardrailDecision: guardrailDecision('guardrail_decision'),
    promptVersion: text('prompt_version'),
    // clock_timestamp(), not now(): messages saved in one transaction must not tie.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('messages_conversation_id_idx').on(t.conversationId),
    check(
      'messages_assistant_prompt_version_check',
      sql`${t.role} <> 'assistant' OR ${t.promptVersion} IS NOT NULL`,
    ),
  ],
);
