import { getTableConfig, PgDialect, type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  chunks,
  conversations,
  documents,
  guardrailDecision,
  messageRole,
  messages,
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
    expect(col(chunks, 'embedding')).toMatchObject({ dimensions: 1024, notNull: true });
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
