import { LlmError, type LlmProvider, type LlmRequest } from './llm-provider.js';

type Responder = (request: LlmRequest) => string[] | Error;

/** Deterministic LlmProvider for tests: scripted deltas, records every request. No I/O, no timers. */
export class MockLlmProvider implements LlmProvider {
  readonly model = 'mock';
  readonly calls: Omit<LlmRequest, 'signal'>[] = [];
  private readonly respond: Responder;

  constructor(respond: string[] | Responder = ['Mock answer.']) {
    if (typeof respond === 'function') this.respond = respond;
    else {
      const script = [...respond]; // copy so later caller mutation can't change replies
      this.respond = () => script;
    }
  }

  async *stream(request: LlmRequest): AsyncIterable<string> {
    const { signal, ...recorded } = request;
    this.calls.push(structuredClone(recorded));
    const result = this.respond(request);
    if (result instanceof Error) throw result;
    for (const delta of result) {
      if (signal?.aborted) throw new LlmError('llm request aborted');
      yield delta;
    }
  }
}
