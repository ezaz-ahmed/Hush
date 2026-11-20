export const EMBEDDING_DIMENSIONS = 1024; // must match chunks.embedding vector(1024)

/** 'document' for KB chunks, 'query' for search queries (providers may embed them differently). */
export type EmbeddingInputType = 'document' | 'query';

/**
 * Turns text into vectors. Inputs are sent to an external service: they must be KB content or
 * user text that has already been through PII redaction (CLAUDE.md rule 1). Implementations
 * never log inputs and never put them in errors.
 */
export interface EmbeddingProvider {
  /** One vector per input, same order, each EMBEDDING_DIMENSIONS long. `[]` gives `[]` with no call. */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

/** Message has status / attempt / batch index only: never input text, response body or API key. */
export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
}
