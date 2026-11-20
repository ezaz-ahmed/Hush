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
export const consentPurpose = pgEnum('consent_purpose', ['chat']);
export const auditActorType = pgEnum('audit_actor_type', ['user', 'admin', 'system']);
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
  // sha256 hex of HASH_VERSION, title, license, url and normalised body (see prepare.ts).
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

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // The only user id ever written to audit_logs; used nowhere else (URLs, cookies, logs, other tables).
  auditSubjectId: uuid('audit_subject_id')
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_user_id_idx').on(t.userId)],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noticeVersion: text('notice_version').notNull(),
    purpose: consentPurpose('purpose').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [index('consents_user_id_idx').on(t.userId)],
);

// Append-only (rule 4). No FKs and no free-form column, so nothing cascades into it and no PII fits.
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  actorType: auditActorType('actor_type').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  // clock_timestamp(), not now(): entries written in one transaction keep their order.
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
});

export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Nulled when the deletion job removes the user, so a completed request keeps no linkable id.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('deletion_requests_user_id_idx').on(t.userId)],
);

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
