import {
  rateLimitErrorSchema,
  type ChatEvent,
  type ChatRequest,
  chatRequestSchema,
} from '@hush/shared';
import { readChatEvents } from './sse';

export type ChatError =
  | { kind: 'rate_limited'; retryAfter: number }
  | { kind: 'http'; status: number }
  | { kind: 'network' }
  | { kind: 'aborted' };

export type ChatResult =
  { ok: true; events: AsyncGenerator<ChatEvent> } | { ok: false; error: ChatError };

const fail = (error: ChatError): ChatResult => ({ ok: false, error });

/** POSTs to the same-origin /api/chat rewrite. Never throws; errors carry no response or user text. */
export const streamChat = async (req: ChatRequest, signal: AbortSignal): Promise<ChatResult> => {
  const parsed = chatRequestSchema.safeParse(req);
  if (!parsed.success) return fail({ kind: 'http', status: 400 });
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal,
    });
  } catch (e) {
    return fail({
      kind: e instanceof DOMException && e.name === 'AbortError' ? 'aborted' : 'network',
    });
  }
  if (res.status === 429) {
    const limit = rateLimitErrorSchema.safeParse(await res.json().catch(() => undefined));
    if (limit.success) return fail({ kind: 'rate_limited', retryAfter: limit.data.retryAfter });
  }
  if (!res.ok || !res.body) return fail({ kind: 'http', status: res.status });
  return { ok: true, events: readChatEvents(res.body) };
};
