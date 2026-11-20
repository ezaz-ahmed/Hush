import { describe, expect, it } from 'vitest';
import { LlmError, type LlmRequest } from './llm-provider.js';
import { MockLlmProvider } from './mock-llm-provider.js';

const request = (): LlmRequest => ({
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 10,
});

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

describe('MockLlmProvider', () => {
  it('has model "mock" and yields a default reply', async () => {
    const mock = new MockLlmProvider();
    expect(mock.model).toBe('mock');
    expect(await collect(mock.stream(request()))).toStrictEqual(['Mock answer.']);
  });

  it('yields scripted deltas in order', async () => {
    const mock = new MockLlmProvider(['a', 'b', 'c']);
    expect(await collect(mock.stream(request()))).toStrictEqual(['a', 'b', 'c']);
  });

  it('is not affected by later mutation of the scripted array', async () => {
    const script = ['a'];
    const mock = new MockLlmProvider(script);
    script.push('b');
    expect(await collect(mock.stream(request()))).toStrictEqual(['a']);
  });

  it('gives the responder the request', async () => {
    const mock = new MockLlmProvider((r) => [r.messages[0]?.content ?? '']);
    expect(await collect(mock.stream(request()))).toStrictEqual(['hi']);
  });

  it('records a deep copy of calls without the signal', async () => {
    const mock = new MockLlmProvider();
    const req = { ...request(), signal: new AbortController().signal };
    await collect(mock.stream(req));
    req.messages[0] = { role: 'user', content: 'changed' };
    expect(mock.calls).toStrictEqual([request()]);
    expect(mock.calls[0]).not.toHaveProperty('signal');
  });

  it('throws a responder Error after recording the call', async () => {
    const boom = new LlmError('llm request failed: status 529');
    const mock = new MockLlmProvider(() => boom);
    await expect(collect(mock.stream(request()))).rejects.toBe(boom);
    expect(mock.calls).toHaveLength(1);
  });

  it('throws llm request aborted before yielding when already aborted', async () => {
    const mock = new MockLlmProvider(['a']);
    const got: string[] = [];
    const run = async () => {
      for await (const d of mock.stream({ ...request(), signal: AbortSignal.abort() })) got.push(d);
    };
    await expect(run()).rejects.toThrow(new LlmError('llm request aborted'));
    expect(got).toStrictEqual([]);
  });

  it('stops between deltas when aborted', async () => {
    const mock = new MockLlmProvider(['a', 'b', 'c']);
    const ac = new AbortController();
    const got: string[] = [];
    const run = async () => {
      for await (const d of mock.stream({ ...request(), signal: ac.signal })) {
        got.push(d);
        ac.abort();
      }
    };
    await expect(run()).rejects.toThrow(new LlmError('llm request aborted'));
    expect(got).toStrictEqual(['a']);
  });

  it('is deterministic for the same input', async () => {
    const mock = new MockLlmProvider(['x', 'y']);
    expect(await collect(mock.stream(request()))).toStrictEqual(
      await collect(mock.stream(request())),
    );
  });
});
