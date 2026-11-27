import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@hush/shared';
import { chatReducer, initialChatState, type ChatState } from './chat-state.js';

const CONV = '11111111-1111-4111-8111-111111111111';
const meta: ChatEvent = { type: 'meta', conversationId: CONV, userMessageId: CONV };
const token = (text: string): ChatEvent => ({ type: 'token', text });
const citation = {
  id: 'S1',
  chunkId: CONV,
  documentId: CONV,
  source: 'faq',
  title: 'FAQ',
  excerpt: 'Some text',
  url: null,
};

const submit = (s: ChatState, text = 'hi', id = 'a') =>
  chatReducer(s, { type: 'submit', text, userId: `u-${id}`, assistantId: `a-${id}` });
const event = (s: ChatState, e: ChatEvent) => chatReducer(s, { type: 'event', event: e });

describe('chatReducer', () => {
  it('submit appends user and pending assistant, status sending', () => {
    const s = submit(initialChatState);
    expect(s.status).toBe('sending');
    expect(s.messages).toEqual([
      { id: 'u-a', role: 'user', content: 'hi' },
      { id: 'a-a', role: 'assistant', content: '', state: 'pending' },
    ]);
  });

  it('ignores empty/whitespace submit', () => {
    expect(submit(initialChatState, '   ')).toBe(initialChatState);
  });

  it('ignores submit while in flight', () => {
    const sending = submit(initialChatState);
    expect(submit(sending, 'again', 'b')).toBe(sending);
    const streaming = event(sending, token('x'));
    expect(submit(streaming, 'again', 'b')).toBe(streaming);
  });

  it('meta stores conversationId', () => {
    expect(event(submit(initialChatState), meta).conversationId).toBe(CONV);
  });

  it('tokens append and move to streaming', () => {
    const s = event(event(submit(initialChatState), token('Hel')), token('lo'));
    expect(s.status).toBe('streaming');
    expect(s.messages[1]).toMatchObject({ content: 'Hello', state: 'streaming' });
  });

  it('done replaces content and stores kind, citations; back to idle', () => {
    let s = event(submit(initialChatState), meta);
    s = event(s, token('draft'));
    s = event(s, {
      type: 'done',
      messageId: CONV,
      kind: 'answer',
      content: 'final [S1]',
      citations: [citation],
    });
    expect(s.status).toBe('idle');
    expect(s.conversationId).toBe(CONV);
    expect(s.messages[1]).toEqual({
      id: 'a-a',
      role: 'assistant',
      content: 'final [S1]',
      state: 'done',
      kind: 'answer',
      citations: [citation],
    });
  });

  it.each([
    [
      { type: 'error', code: 'llm_unavailable' },
      'The assistant is unavailable right now. Please try again.',
    ],
    [{ type: 'error', code: 'internal' }, 'Something went wrong. Please try again.'],
  ] as const)('error event %j gives fixed copy', (e, copy) => {
    const s = event(submit(initialChatState), e);
    expect(s.status).toBe('error');
    expect(s.messages[1]).toMatchObject({ state: 'error', content: copy });
  });

  it.each([
    ['http', 'Something went wrong. Please try again.'],
    ['stream', 'Something went wrong. Please try again.'],
    ['network', "Couldn't reach Hush. Check your connection and try again."],
  ] as const)('fail %s gives fixed copy', (cause, copy) => {
    const s = chatReducer(submit(initialChatState), { type: 'fail', cause });
    expect(s.status).toBe('error');
    expect(s.messages[1]).toMatchObject({ state: 'error', content: copy });
    expect(s.retryAfter).toBeNull();
  });

  it('rate_limited uses retryAfter copy and blocks submit and retry until cleared', () => {
    const s = chatReducer(submit(initialChatState), {
      type: 'fail',
      cause: 'rate_limited',
      retryAfter: 7,
    });
    expect(s.retryAfter).toBe(7);
    expect(s.messages[1]?.content).toBe(
      "You're sending messages too fast. Try again in 7 seconds.",
    );
    expect(submit(s, 'x', 'b')).toBe(s);
    expect(chatReducer(s, { type: 'retry', assistantId: 'a-b' })).toBe(s);
    const cleared = chatReducer(s, { type: 'rate_limit_expired' });
    expect(cleared.retryAfter).toBeNull();
    expect(chatReducer(cleared, { type: 'retry', assistantId: 'a-b' }).status).toBe('sending');
  });

  it('retry replaces failed assistant turn, keeps one user message', () => {
    let s = event(submit(initialChatState, 'question'), meta);
    s = chatReducer(s, { type: 'fail', cause: 'network' });
    s = chatReducer(s, { type: 'retry', assistantId: 'a-r' });
    expect(s.status).toBe('sending');
    expect(s.messages).toEqual([
      { id: 'u-a', role: 'user', content: 'question' },
      { id: 'a-r', role: 'assistant', content: '', state: 'pending' },
    ]);
    expect(s.conversationId).toBe(CONV);
  });

  it('retry is ignored unless in error', () => {
    expect(chatReducer(initialChatState, { type: 'retry', assistantId: 'x' })).toBe(
      initialChatState,
    );
  });

  it('uses singular copy for a 1 second wait', () => {
    const s = chatReducer(submit(initialChatState), {
      type: 'fail',
      cause: 'rate_limited',
      retryAfter: 1,
    });
    expect(s.messages[1]).toMatchObject({ content: expect.stringContaining('in 1 second.') });
  });

  it('events and failures are ignored when nothing is in flight', () => {
    expect(event(initialChatState, token('x'))).toBe(initialChatState);
    expect(chatReducer(initialChatState, { type: 'fail', cause: 'http' })).toBe(initialChatState);
  });
});
