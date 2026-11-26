import { and, cosineDistance, desc, eq, lte, sql } from 'drizzle-orm';
import { chunks, documents } from '../database/schema.js';
import type { Db } from '../database/database.module.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { fuseRrf } from './rrf.js';

export const DEFAULT_TOP_K = 5;
export const DEFAULT_MIN_SCORE = 0.3; // placeholder until retrieval evals (#65)
export const MAX_TOP_K = 40;
export type RetrievalMode = 'vector' | 'hybrid';
export const DEFAULT_MODE: RetrievalMode = 'vector'; // hybrid opt-in until #70 has eval numbers
export const HYBRID_CANDIDATES = MAX_TOP_K; // per list, before fusion

export interface RetrieveOptions {
  topK?: number; // integer 1..MAX_TOP_K, default DEFAULT_TOP_K
  minScore?: number; // -1..1, default DEFAULT_MIN_SCORE
  mode?: RetrievalMode; // default DEFAULT_MODE
}

export interface RetrievedChunk {
  chunkId: string;
  text: string;
  headingPath: string[];
  score: number; // cosine similarity, 1 - (embedding <=> query)
  documentId: string;
  source: string;
  title: string;
  license: string;
  url: string | null;
}

/**
 * Returns up to topK chunks with score >= minScore, best first (ties by chunk id).
 * In 'hybrid' mode the vector and full-text rankings are fused by RRF, so the result is ordered
 * by RRF, not by score: take the max score, not the first element. `score` stays cosine.
 * `query` is sent to the embedding provider: it must already have been through PII
 * redaction (CLAUDE.md rule 1; enforced by the chat pipeline, #40). Never logs.
 * A DB failure surfaces drizzle's DrizzleQueryError, which includes the query embedding (and, in
 * hybrid mode, the query text) in its params; in hybrid mode Postgres can also echo the query text
 * in the error message itself (e.g. an over-long tsquery). Callers must not log raw DB errors.
 */
export async function retrieve(
  db: Db,
  embedder: EmbeddingProvider,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const { topK = DEFAULT_TOP_K, minScore = DEFAULT_MIN_SCORE, mode = DEFAULT_MODE } = options;
  // MAX_TOP_K = default hnsw.ef_search: an HNSW index scan returns at most 40 rows, so a larger topK could come back short
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new RangeError(`topK must be an integer from 1 to ${MAX_TOP_K}`);
  }
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new RangeError('minScore must be a finite number from -1 to 1');
  }
  if (mode !== 'vector' && mode !== 'hybrid') {
    throw new RangeError("mode must be 'vector' or 'hybrid'");
  }
  if (query.trim() === '') return [];

  const [vector] = await embedder.embed([query], 'query');
  if (!vector) throw new EmbeddingError('Embedding provider returned no vector');

  const distance = cosineDistance(chunks.embedding, vector);
  const select = () =>
    db
      .select({
        chunkId: chunks.id,
        text: chunks.text,
        headingPath: chunks.headingPath,
        score: sql<number>`1 - (${distance})`,
        documentId: documents.id,
        source: documents.source,
        title: documents.title,
        license: documents.license,
        url: documents.url,
      })
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id));

  if (mode === 'vector') {
    return select()
      .where(lte(distance, 1 - minScore))
      .orderBy(distance, chunks.id)
      .limit(topK);
  }

  // OR over the query's lexemes; plainto_tsquery takes no operator syntax, the text is a bound param
  const tsq = sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;
  const [vectorRows, ftsRows] = await Promise.all([
    select()
      .where(lte(distance, 1 - minScore))
      .orderBy(distance, chunks.id)
      .limit(HYBRID_CANDIDATES),
    select()
      .where(and(sql`${chunks.tsv} @@ ${tsq}`, lte(distance, 1 - minScore)))
      .orderBy(desc(sql`ts_rank(${chunks.tsv}, ${tsq})`), chunks.id)
      .limit(HYBRID_CANDIDATES),
  ]);
  const byId = new Map([...vectorRows, ...ftsRows].map((r) => [r.chunkId, r]));
  return fuseRrf([vectorRows.map((r) => r.chunkId), ftsRows.map((r) => r.chunkId)])
    .slice(0, topK)
    .flatMap(({ id }) => byId.get(id) ?? []);
}
