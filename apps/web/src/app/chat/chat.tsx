'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import { CHAT_MESSAGE_MAX } from '@hush/shared';
import { streamChat } from '../../lib/chat-client';
import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chat-state';

export type ChatViewProps = {
  state: ChatState;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
};

export function ChatView({
  state,
  input,
  onInputChange,
  onSubmit,
  onRetry,
  inputRef,
}: ChatViewProps) {
  const inFlight = state.status === 'sending' || state.status === 'streaming';
  const blocked = inFlight || state.retryAfter !== null;
  const lastId = state.messages[state.messages.length - 1]?.id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-4">
      <div role="log" aria-live="polite" className="flex flex-1 flex-col gap-3">
        {state.messages.map((m) =>
          m.role === 'user' ? (
            <p key={m.id} className="self-end rounded bg-neutral-100 px-3 py-2 text-sm">
              {m.content}
            </p>
          ) : (
            <div
              key={m.id}
              aria-busy={m.state === 'streaming' || m.state === 'pending'}
              className="self-start text-sm"
            >
              {m.state === 'pending' ? (
                <p className="text-neutral-500">Thinking...</p>
              ) : (
                <p
                  className={
                    m.state === 'error' ? 'whitespace-pre-wrap text-red-600' : 'whitespace-pre-wrap'
                  }
                >
                  {m.content}
                </p>
              )}
              {m.state === 'error' && m.id === lastId && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={blocked}
                  className="mt-1 text-sm underline disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </div>
          ),
        )}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="chat-input" className="text-sm text-neutral-500">
          Your question
        </label>
        <textarea
          id="chat-input"
          value={input}
          ref={inputRef}
          maxLength={CHAT_MESSAGE_MAX}
          disabled={inFlight}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          className="rounded border border-neutral-300 p-2 text-sm"
        />
        <button
          type="submit"
          disabled={blocked || !input.trim()}
          className="self-end rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export function Chat() {
  const [state, setState] = useState<ChatState>(initialChatState);
  const [input, setInput] = useState('');
  // Mirror of state, updated synchronously so handlers never read a stale closure.
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`; // randomUUID is unavailable on non-secure origins

  const dispatch = useCallback((action: ChatAction): boolean => {
    const next = chatReducer(stateRef.current, action);
    if (next === stateRef.current) return false; // reducer ignored it
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const run = useCallback(
    async (message: string) => {
      abortRef.current?.abort(); // a superseded run must not touch the new turn
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const live = () => !ctrl.signal.aborted;
      const result = await streamChat(
        { conversationId: stateRef.current.conversationId, message },
        ctrl.signal,
      );
      if (!live()) return;
      if (!result.ok) {
        const e = result.error;
        if (e.kind === 'aborted') return;
        if (e.kind === 'rate_limited')
          dispatch({ type: 'fail', cause: 'rate_limited', retryAfter: e.retryAfter });
        else dispatch({ type: 'fail', cause: e.kind === 'network' ? 'network' : 'http' });
        return;
      }
      let done = false;
      try {
        for await (const event of result.events) {
          if (!live()) return;
          if (event.type === 'done' || event.type === 'error') done = true;
          dispatch({ type: 'event', event });
        }
      } catch {
        if (!live()) return;
      }
      if (live() && !done) {
        dispatch({ type: 'fail', cause: 'stream' });
      }
    },
    [dispatch],
  );

  const onSubmit = () => {
    const text = input.trim();
    if (
      !dispatch({
        type: 'submit',
        text,
        userId: nextId(),
        assistantId: nextId(),
      })
    )
      return;
    setInput('');
    void run(text);
  };

  const onRetry = () => {
    const last = stateRef.current.messages.findLast((m) => m.role === 'user');
    if (!last) return;
    if (dispatch({ type: 'retry', assistantId: nextId() })) void run(last.content);
  };

  // Abort silently on unmount; also covers strict-mode's mount/unmount/mount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = state.status === 'sending' || state.status === 'streaming';
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    if (state.retryAfter === null) return;
    const t = setTimeout(() => dispatch({ type: 'rate_limit_expired' }), state.retryAfter * 1000);
    return () => clearTimeout(t);
  }, [state.retryAfter, dispatch]);

  return (
    <ChatView
      state={state}
      input={input}
      onInputChange={setInput}
      onSubmit={onSubmit}
      onRetry={onRetry}
      inputRef={inputRef}
    />
  );
}
