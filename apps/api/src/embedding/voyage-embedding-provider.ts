import { z } from 'zod';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  type EmbeddingInputType,
  type EmbeddingProvider,
} from './embedding-provider.js';

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  batchSize?: number; // integer 1..1000 (Voyage's per-request input cap)
  maxAttempts?: number; // 1 initial + retries
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number; // per request
  fetch?: typeof fetch; // test seam
  sleep?: (ms: number) => Promise<void>; // test seam
  random?: () => number; // test seam for jitter
}

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
});

class RetryableFailure extends Error {
  constructor(
    readonly reason: string,
    readonly retryAfterMs?: number,
  ) {
    super(reason);
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const retryAfterMs = (res: Response): number | undefined => {
  if (res.status !== 429 && res.status !== 503) return undefined;
  // HTTP-date form is ignored (falls back to backoff).
  const h = res.headers.get('retry-after')?.trim();
  return h && /^\d+$/.test(h) ? Number(h) * 1000 : undefined;
};

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly #apiKey: string;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(o: VoyageOptions) {
    this.#apiKey = o.apiKey;
    this.model = o.model ?? 'voyage-3.5';
    this.batchSize = o.batchSize ?? 128;
    this.maxAttempts = o.maxAttempts ?? 5;
    this.baseDelayMs = o.baseDelayMs ?? 500;
    this.maxDelayMs = o.maxDelayMs ?? 8000;
    this.timeoutMs = o.timeoutMs ?? 30000;
    this.fetchFn = o.fetch ?? globalThis.fetch;
    this.sleep = o.sleep ?? defaultSleep;
    this.random = o.random ?? Math.random;
    if (!this.#apiKey) throw new EmbeddingError('invalid Voyage option: apiKey is empty');
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 1000)
      throw new EmbeddingError('invalid Voyage option: batchSize must be an integer 1..1000');
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new EmbeddingError('invalid Voyage option: maxAttempts must be an integer >= 1');
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new EmbeddingError('invalid Voyage option: timeoutMs must be a finite number > 0');
    if (!Number.isFinite(this.baseDelayMs) || this.baseDelayMs < 0)
      throw new EmbeddingError('invalid Voyage option: baseDelayMs must be a finite number >= 0');
    if (!Number.isFinite(this.maxDelayMs) || this.maxDelayMs < 0)
      throw new EmbeddingError('invalid Voyage option: maxDelayMs must be a finite number >= 0');
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const out: number[][] = [];
    // shortcut: batches split by count only, not tokens; add a token budget if chunk size grows.
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batchNo = i / this.batchSize + 1;
      out.push(...(await this.embedBatch(texts.slice(i, i + this.batchSize), inputType, batchNo)));
    }
    return out;
  }

  private async embedBatch(
    batch: string[],
    inputType: EmbeddingInputType,
    batchNo: number,
  ): Promise<number[][]> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.request(batch, inputType, batchNo);
      } catch (e) {
        if (!(e instanceof RetryableFailure)) throw e;
        if (attempt >= this.maxAttempts)
          throw new EmbeddingError(
            `embedding request failed: ${e.reason} after ${attempt} attempts (batch ${batchNo})`,
          );
        const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
        await this.sleep(
          e.retryAfterMs === undefined
            ? this.random() * backoff
            : Math.min(this.maxDelayMs, e.retryAfterMs),
        );
      }
    }
  }

  private async request(
    batch: string[],
    inputType: EmbeddingInputType,
    batchNo: number,
  ): Promise<number[][]> {
    let res: Response;
    try {
      res = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: batch,
          model: this.model,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new RetryableFailure(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error',
      );
    }
    if (!res.ok) await res.body?.cancel().catch(() => undefined); // release the connection
    if (res.status === 429 || res.status >= 500)
      throw new RetryableFailure(`status ${res.status}`, retryAfterMs(res));
    if (!res.ok)
      throw new EmbeddingError(`embedding request failed: status ${res.status} (batch ${batchNo})`);

    const invalid = new EmbeddingError(`invalid embedding response (batch ${batchNo})`);
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await res.json());
    } catch (e) {
      // the timeout signal can fire while the body is being read
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new RetryableFailure('timeout');
      throw invalid;
    }
    if (parsed.data.length !== batch.length) throw invalid;
    const vectors: (number[] | undefined)[] = new Array<number[] | undefined>(batch.length);
    for (const { embedding, index } of parsed.data) {
      if (
        index < 0 ||
        index >= batch.length ||
        vectors[index] ||
        embedding.length !== EMBEDDING_DIMENSIONS
      )
        throw invalid;
      vectors[index] = embedding;
    }
    return vectors as number[][]; // every slot filled: count matches and indices are unique and in range
  }
}
