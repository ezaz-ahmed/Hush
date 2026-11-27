import type { ChatCitation, ChatEvent } from '@hush/shared';

export type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      state: 'pending' | 'streaming' | 'done' | 'error';
      kind?: 'answer' | 'no_answer';
      citations?: ChatCitation[];
    };

export type ChatState = {
  messages: ChatMessage[];
  conversationId?: string;
  status: 'idle' | 'sending' | 'streaming' | 'error';
  /** Seconds from a 429; non-null blocks submit and retry until `rate_limit_expired`. */
  retryAfter: number | null;
};

export type FailCause = 'http' | 'network' | 'stream' | 'rate_limited';

export type ChatAction =
  | { type: 'submit'; text: string; userId: string; assistantId: string }
  | { type: 'event'; event: ChatEvent }
  | { type: 'fail'; cause: Exclude<FailCause, 'rate_limited'> }
  | { type: 'fail'; cause: 'rate_limited'; retryAfter: number }
  | { type: 'retry'; assistantId: string }
  | { type: 'rate_limit_expired' };

export const initialChatState: ChatState = { messages: [], status: 'idle', retryAfter: null };

const GENERIC = 'Something went wrong. Please try again.';
const NETWORK = "Couldn't reach Hush. Check your connection and try again.";
const UNAVAILABLE = 'The assistant is unavailable right now. Please try again.';

const inFlight = (s: ChatState) => s.status === 'sending' || s.status === 'streaming';

// Updates the last message (the in-flight assistant turn).
type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;
function patchLast(
  s: ChatState,
  patch: Partial<AssistantMessage>,
  rest: Partial<ChatState>,
): ChatState {
  const messages = s.messages.slice();
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return s;
  messages[messages.length - 1] = { ...last, ...patch };
  return { ...s, ...rest, messages };
}

function fail(s: ChatState, content: string, retryAfter: number | null): ChatState {
  return patchLast(s, { state: 'error', content }, { status: 'error', retryAfter });
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case 'submit':
      if (inFlight(s) || s.retryAfter !== null || !a.text.trim()) return s;
      return {
        ...s,
        status: 'sending',
        messages: [
          ...s.messages,
          { id: a.userId, role: 'user', content: a.text },
          { id: a.assistantId, role: 'assistant', content: '', state: 'pending' },
        ],
      };
    case 'retry': {
      if (s.status !== 'error' || s.retryAfter !== null) return s;
      const messages = s.messages.slice(0, -1); // drop failed assistant turn
      messages.push({ id: a.assistantId, role: 'assistant', content: '', state: 'pending' });
      return { ...s, status: 'sending', messages };
    }
    case 'event': {
      if (!inFlight(s)) return s;
      const e = a.event;
      switch (e.type) {
        case 'meta':
          return { ...s, conversationId: e.conversationId };
        case 'token': {
          const last = s.messages[s.messages.length - 1];
          const prev = last?.role === 'assistant' ? last.content : '';
          return patchLast(
            s,
            { state: 'streaming', content: prev + e.text },
            { status: 'streaming' },
          );
        }
        case 'done':
          return patchLast(
            s,
            { state: 'done', content: e.content, kind: e.kind, citations: e.citations },
            { status: 'idle' },
          );
        case 'error':
        default: // exhaustive; default lets lint see every path returns
          return fail(s, e.code === 'llm_unavailable' ? UNAVAILABLE : GENERIC, null);
      }
    }
    case 'fail':
      if (!inFlight(s)) return s;
      if (a.cause === 'rate_limited') {
        const n = a.retryAfter;
        return fail(
          s,
          `You're sending messages too fast. Try again in ${n} ${n === 1 ? 'second' : 'seconds'}.`,
          n,
        );
      }
      return fail(s, a.cause === 'network' ? NETWORK : GENERIC, null);
    case 'rate_limit_expired':
      return s.retryAfter === null ? s : { ...s, retryAfter: null };
  }
}
