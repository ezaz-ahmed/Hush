import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@hush/shared';
import { sseFrame } from './sse.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('sseFrame', () => {
  it('frames a meta event', () => {
    const e: ChatEvent = { type: 'meta', conversationId: id, userMessageId: id };
    expect(sseFrame(e)).toBe(`event: meta\ndata: ${JSON.stringify(e)}\n\n`);
  });

  it('frames a token event', () => {
    expect(sseFrame({ type: 'token', text: 'hi' })).toBe(
      'event: token\ndata: {"type":"token","text":"hi"}\n\n',
    );
  });

  it('frames a done event', () => {
    const e: ChatEvent = {
      type: 'done',
      messageId: id,
      kind: 'answer',
      content: 'x [S1]',
      citations: [
        {
          id: 'S1',
          chunkId: id,
          documentId: id,
          source: 'a.md',
          title: 'A',
          excerpt: 'x',
          url: null,
        },
      ],
    };
    expect(sseFrame(e)).toBe(`event: done\ndata: ${JSON.stringify(e)}\n\n`);
  });

  it('frames an error event', () => {
    expect(sseFrame({ type: 'error', code: 'internal' })).toBe(
      'event: error\ndata: {"type":"error","code":"internal"}\n\n',
    );
  });

  it('keeps newlines in text on a single data line', () => {
    const frame = sseFrame({ type: 'token', text: 'a\nb\r\nc' });
    expect(frame).toBe('event: token\ndata: {"type":"token","text":"a\\nb\\r\\nc"}\n\n');
    expect(frame.split('\n')).toHaveLength(4);
  });

  it('throws on an event that fails the schema', () => {
    expect(() => sseFrame({ type: 'error', code: 'nope' } as unknown as ChatEvent)).toThrow();
    expect(() => sseFrame({ type: 'token' } as unknown as ChatEvent)).toThrow();
  });
});
