import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk';
import { LlmError, type LlmProvider, type LlmRequest } from './llm-provider.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string; // callers pass env.ANTHROPIC_MODEL
  timeoutMs?: number; // per request
  maxRetries?: number; // SDK retries (429, 5xx, connection); tests pass 0
  fetch?: typeof fetch; // test seam
}

const ABORTED = 'llm request aborted';

// Message carries a status or an error type only, never SDK message/body text (it can echo input).
const toLlmError = (e: unknown, signal?: AbortSignal): LlmError => {
  if (e instanceof LlmError) return e;
  // abort surfaces as the SDK's abort error or a plain AbortError, depending on where it fires
  if (signal?.aborted || (e instanceof Error && e.name === 'AbortError'))
    return new LlmError(ABORTED);
  // order matters: timeout extends connection extends APIError
  if (e instanceof APIConnectionTimeoutError) return new LlmError('llm request failed: timeout');
  if (e instanceof APIConnectionError) return new LlmError('llm request failed: network error');
  if (e instanceof APIError) {
    if (e.status !== undefined) return new LlmError(`llm request failed: status ${e.status}`);
    if (e.type && /^[a-z_]+$/.test(e.type)) return new LlmError(`llm stream error: ${e.type}`);
  }
  return new LlmError('llm request failed');
};

export class AnthropicLlmProvider implements LlmProvider {
  readonly model: string;
  private readonly client: Anthropic;

  constructor(o: AnthropicOptions) {
    const timeout = o.timeoutMs ?? 60000;
    if (!o.apiKey) throw new LlmError('invalid Anthropic option: apiKey is empty');
    if (!o.model) throw new LlmError('invalid Anthropic option: model is empty');
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new LlmError('invalid Anthropic option: timeoutMs must be a finite number > 0');
    this.model = o.model;
    this.client = new Anthropic({
      apiKey: o.apiKey,
      timeout,
      maxRetries: o.maxRetries,
      fetch: o.fetch,
      logLevel: 'off',
      // pinned: the SDK would otherwise read ANTHROPIC_BASE_URL, an unvalidated host that would receive user text
      baseURL: 'https://api.anthropic.com',
      // no spans: the SDK can attach prompt/response content to OpenTelemetry traces
      openTelemetry: false,
    });
  }

  async *stream(request: LlmRequest): AsyncIterable<string> {
    const { signal } = request;
    try {
      const events = await this.client.messages.create(
        {
          model: this.model,
          system: request.system,
          messages: request.messages,
          max_tokens: request.maxTokens,
          stream: true,
        },
        { signal },
      );
      for await (const event of events) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
          yield event.delta.text;
      }
      // the SDK ends a stream quietly when the caller aborts mid-read
      if (signal?.aborted) throw new LlmError(ABORTED);
    } catch (e) {
      throw toLlmError(e, signal);
    }
  }
}
