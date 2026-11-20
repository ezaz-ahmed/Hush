export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[]; // non-empty, first is 'user' (the API rejects anything else with a 400)
  maxTokens: number;
  signal?: AbortSignal; // abort when the client disconnects
}

/**
 * Streams a model reply as text deltas. Inputs go to an external service: user text must already
 * have been through PII redaction (CLAUDE.md rule 1). Implementations never log inputs or outputs
 * and never put them in errors.
 */
export interface LlmProvider {
  readonly model: string; // so callers can record which model answered
  stream(request: LlmRequest): AsyncIterable<string>;
}

/** Message has a status or error type only: never prompt text, response text or API key. */
export class LlmError extends Error {
  override name = 'LlmError';
}
