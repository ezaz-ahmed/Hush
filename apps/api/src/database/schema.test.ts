import { getTableConfig, PgDialect, type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../embedding/embedding-provider.js';
import {
  auditActorType,
  auditLogs,
  chunks,
  consentPurpose,
  consents,
  conversations,
  deletionRequests,
  documents,
  guardrailDecision,
  messageRole,
  messages,
  users,
} from './schema.js';
import type { Citation } from './schema.js';

const col = (table: Parameters<typeof getTableConfig>[0], name: string): PgColumn => {
  const found = getTableConfig(table).columns.find((c) => c.name === name);
  if (!found) throw new Error(`missing column ${name}`);
  return found;
};

describe('schema', () => {
  it('cascades chunks.document_id and messages.conversation_id', () => {
    for (const [table, column, parent] of [
      [chunks, 'document_id', documents],
      [messages, 'conversation_id', conversations],
    ] as const) {
      const fk = getTableConfig(table).foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === column),
      );
      expect(fk?.onDelete).toBe('cascade');
      expect(fk?.reference().foreignTable).toBe(parent);
    }
  });

  it('indexes chunks with hnsw cosine on embedding and gin on tsv', () => {
    const indexes = getTableConfig(chunks).indexes.map((i) => i.config);
    const hnsw = indexes.find((i) => i.method === 'hnsw');
    const gin = indexes.find((i) => i.method === 'gin');
    expect(hnsw?.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['embedding']);
    expect(hnsw?.columns[0]).toMatchObject({ indexConfig: { opClass: 'vector_cosine_ops' } });
    expect(gin?.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['tsv']);
  });

  it('has btree indexes on both foreign keys', () => {
    const names = (t: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(t).indexes.flatMap((i) =>
        i.config.method === 'btree' || i.config.method === undefined
          ? i.config.columns.map((c) => ('name' in c ? c.name : ''))
          : [],
      );
    expect(names(chunks)).toContain('document_id');
    expect(names(messages)).toContain('conversation_id');
  });

  it('uses 1024-dimension embeddings and a generated tsv', () => {
    expect(col(chunks, 'embedding')).toMatchObject({
      dimensions: EMBEDDING_DIMENSIONS,
      notNull: true,
    });
    const tsv = col(chunks, 'tsv');
    expect(tsv.generated).toBeDefined();
    expect(tsv.generated?.type).toBe('always');
    expect(tsv.getSQLType()).toBe('tsvector');
    expectTypeOf<typeof chunks.$inferInsert>().not.toHaveProperty('tsv');
  });

  it('makes documents.source unique', () => {
    expect(col(documents, 'source').isUnique).toBe(true);
  });

  it('checks prompt_version on messages and defines the enums', () => {
    const check = getTableConfig(messages).checks.find(
      (c) => c.name === 'messages_assistant_prompt_version_check',
    );
    expect(check).toBeDefined();
    // `!` is safe: check asserted defined above.
    const { sql: checkSql } = new PgDialect().sqlToQuery(check!.value);
    expect(checkSql).toContain(`<> 'assistant' OR`);
    expect(checkSql).toContain('"prompt_version" IS NOT NULL');
    expect(messageRole.enumValues).toEqual(['user', 'assistant']);
    expect(guardrailDecision.enumValues).toEqual([
      'allowed',
      'emergency',
      'diagnosis',
      'dosage',
      'off_topic',
    ]);
  });

  it('types citations as a jsonb Citation[] defaulting to []', () => {
    const citations = col(messages, 'citations');
    expect(citations.getSQLType()).toBe('jsonb');
    expect(citations.notNull).toBe(true);
    expect(citations.default).toEqual([]);
    type Selected = typeof messages.$inferSelect.citations;
    expectTypeOf<Selected>().toEqualTypeOf<Citation[]>();
    expectTypeOf<Citation>().toEqualTypeOf<{
      chunkId: string;
      documentId: string;
      source: string;
    }>();
  });
});

type AnyTable = Parameters<typeof getTableConfig>[0];
const colNames = (t: AnyTable) => getTableConfig(t).columns.map((c) => c.name);
const defaultSql = (t: AnyTable, name: string) => {
  const d = col(t, name).default;
  return new PgDialect().sqlToQuery(d as Parameters<PgDialect['sqlToQuery']>[0]).sql;
};
const fkOn = (t: AnyTable, column: string) =>
  getTableConfig(t).foreignKeys.find((f) => f.reference().columns.some((c) => c.name === column));
const btreeCols = (t: AnyTable) =>
  getTableConfig(t).indexes.flatMap((i) =>
    i.config.method === 'btree' || i.config.method === undefined
      ? i.config.columns.map((c) => ('name' in c ? c.name : ''))
      : [],
  );

describe('privacy schema', () => {
  it('cascades conversations.user_id and consents.user_id from users, NOT NULL', () => {
    for (const table of [conversations, consents]) {
      const fk = fkOn(table, 'user_id');
      expect(fk?.onDelete).toBe('cascade');
      expect(fk?.reference().foreignTable).toBe(users);
      expect(col(table, 'user_id').notNull).toBe(true);
    }
  });

  it('gives audit_logs no foreign keys', () => {
    expect(getTableConfig(auditLogs).foreignKeys).toEqual([]);
  });

  it('nulls deletion_requests.user_id when the user is deleted', () => {
    const fk = fkOn(deletionRequests, 'user_id');
    expect(fk?.onDelete).toBe('set null');
    expect(fk?.reference().foreignTable).toBe(users);
    expect(col(deletionRequests, 'user_id').notNull).toBe(false);
  });

  it('keeps audit_logs to the exact no-PII column list with clock_timestamp()', () => {
    expect(colNames(auditLogs)).toEqual([
      'id',
      'actor_type',
      'actor_id',
      'action',
      'resource_type',
      'resource_id',
      'created_at',
    ]);
    expect(defaultSql(auditLogs, 'created_at')).toBe('clock_timestamp()');
  });

  it('keeps users anonymous with a unique random audit_subject_id', () => {
    expect(colNames(users)).toEqual(['id', 'audit_subject_id', 'created_at']);
    const subject = col(users, 'audit_subject_id');
    expect(subject.getSQLType()).toBe('uuid');
    expect(subject.notNull).toBe(true);
    expect(subject.isUnique).toBe(true);
    expect(defaultSql(users, 'audit_subject_id')).toBe('gen_random_uuid()');
  });

  it('has btree indexes on the user_id foreign keys', () => {
    expect(btreeCols(conversations)).toContain('user_id');
    expect(btreeCols(consents)).toContain('user_id');
    expect(btreeCols(deletionRequests)).toContain('user_id');
  });

  it('defines the consent_purpose and audit_actor_type enums', () => {
    expect(consentPurpose.enumValues).toEqual(['chat']);
    expect(auditActorType.enumValues).toEqual(['user', 'admin', 'system']);
  });

  it('makes withdrawn_at and completed_at nullable, granted_at and requested_at defaulted', () => {
    expect(col(consents, 'withdrawn_at').notNull).toBe(false);
    expect(col(deletionRequests, 'completed_at').notNull).toBe(false);
    for (const [table, name] of [
      [consents, 'granted_at'],
      [deletionRequests, 'requested_at'],
    ] as const) {
      expect(col(table, name).notNull).toBe(true);
      expect(col(table, name).hasDefault).toBe(true);
    }
  });
});
