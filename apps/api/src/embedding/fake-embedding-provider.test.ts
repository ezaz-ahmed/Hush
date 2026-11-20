import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from './embedding-provider.js';
import { FakeEmbeddingProvider } from './fake-embedding-provider.js';

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const cosine = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0) / (norm(a) * norm(b));

describe('FakeEmbeddingProvider', () => {
  it('gives identical vectors for the same text across instances', async () => {
    const a = await new FakeEmbeddingProvider().embed(['hair loss treatment'], 'document');
    const b = await new FakeEmbeddingProvider().embed(['hair loss treatment'], 'query');
    expect(a).toEqual(b);
  });

  it('returns unit-length vectors of EMBEDDING_DIMENSIONS, including for empty text', async () => {
    const vectors = await new FakeEmbeddingProvider().embed(['some text', ''], 'document');
    for (const v of vectors) {
      expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(norm(v)).toBeCloseTo(1, 10);
    }
  });

  it('scores texts sharing words higher than unrelated texts', async () => {
    const vectors = await new FakeEmbeddingProvider().embed(
      [
        'how to book a clinic appointment',
        'book an appointment at the clinic',
        'zebra quantum xylophone',
      ],
      'document',
    );
    expect(vectors).toHaveLength(3);
    const [base = [], related = [], unrelated = []] = vectors;
    expect(cosine(base, related)).toBeGreaterThan(cosine(base, unrelated));
  });

  it('keeps output order matching input order', async () => {
    const provider = new FakeEmbeddingProvider();
    const [a, b] = await provider.embed(['alpha', 'beta'], 'document');
    expect(await provider.embed(['beta', 'alpha'], 'document')).toEqual([b, a]);
  });

  it('records texts and inputType per call, including empty calls', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.embed(['x', 'y'], 'query');
    expect(await provider.embed([], 'document')).toEqual([]);
    expect(provider.calls).toEqual([
      { texts: ['x', 'y'], inputType: 'query' },
      { texts: [], inputType: 'document' },
    ]);
  });
});
