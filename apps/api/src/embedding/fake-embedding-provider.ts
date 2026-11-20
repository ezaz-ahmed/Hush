import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingInputType,
  type EmbeddingProvider,
} from './embedding-provider.js';

function fnv1a32(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

/** Deterministic bag-of-words embedder for tests: shared words give higher cosine. No network. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly calls: { texts: string[]; inputType: EmbeddingInputType }[] = [];

  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    this.calls.push({ texts: [...texts], inputType });
    return Promise.resolve(texts.map(vectorFor));
  }
}

function vectorFor(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = 1; // bias keeps the vector non-zero for empty text
  for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const bucket = fnv1a32(word) % EMBEDDING_DIMENSIONS;
    v[bucket] = (v[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}
