import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX,
  CITATION_MARKER,
  chatCitationSchema,
  chatEventSchema,
  chatRequestSchema,
} from './chat.js';

const id = '3f2b8a3e-6a0e-4d6c-9a57-0c1f3b6d2e11';
const citation = {
  id: 'S1',
  chunkId: id,
  documentId: id,
  source: 'clinic/faq.md',
  title: 'FAQ',
  excerpt: 'Some text.',
  url: null,
};

describe('chatRequestSchema', () => {
  it('accepts a message without conversationId', () => {
    expect(chatRequestSchema.parse({ message: 'hi' })).toEqual({ message: 'hi' });
  });

  it('accepts a message with a uuid conversationId and trims it', () => {
    expect(chatRequestSchema.parse({ conversationId: id, message: '  hi  ' })).toEqual({
      conversationId: id,
      message: 'hi',
    });
  });

  it('rejects blank and whitespace-only messages', () => {
    expect(chatRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: '   \n ' }).success).toBe(false);
  });

  it('enforces the max length after trim', () => {
    expect(chatRequestSchema.safeParse({ message: 'a'.repeat(CHAT_MESSAGE_MAX) }).success).toBe(
      true,
    );
    expect(chatRequestSchema.safeParse({ message: 'a'.repeat(CHAT_MESSAGE_MAX + 1) }).success).toBe(
      false,
    );
  });

  it('rejects a non-uuid conversationId', () => {
    expect(chatRequestSchema.safeParse({ conversationId: 'nope', message: 'hi' }).success).toBe(
      false,
    );
  });

  it('rejects extra keys', () => {
    expect(chatRequestSchema.safeParse({ message: 'hi', extra: 1 }).success).toBe(false);
  });
});

describe('chatCitationSchema', () => {
  it('accepts a valid citation', () => {
    expect(chatCitationSchema.parse(citation)).toEqual(citation);
  });

  it('rejects a bad marker id and extra keys', () => {
    expect(chatCitationSchema.safeParse({ ...citation, id: 's1' }).success).toBe(false);
    expect(chatCitationSchema.safeParse({ ...citation, id: 'S1a' }).success).toBe(false);
    expect(chatCitationSchema.safeParse({ ...citation, extra: 1 }).success).toBe(false);
  });

  it('accepts an https url', () => {
    const c = { ...citation, url: 'https://example.com/a' };
    expect(chatCitationSchema.parse(c)).toEqual(c);
  });

  it('rejects non-http(s) urls', () => {
    expect(chatCitationSchema.safeParse({ ...citation, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(chatCitationSchema.safeParse({ ...citation, url: 'ftp://example.com/a' }).success).toBe(
      false,
    );
  });

  it('requires title and excerpt', () => {
    expect(chatCitationSchema.safeParse({ ...citation, title: undefined }).success).toBe(false);
    expect(chatCitationSchema.safeParse({ ...citation, excerpt: undefined }).success).toBe(false);
  });
});

describe('CITATION_MARKER', () => {
  const found = (s: string) => [...s.matchAll(CITATION_MARKER)].map((m) => m[1]);

  it('matches single and grouped markers', () => {
    expect(found('a [S1] b [S1, S3] c [S1,S3]')).toEqual(['S1', 'S1, S3', 'S1,S3']);
  });

  it('ignores malformed markers', () => {
    expect(found('[s1] [S1,] [ S1 ]')).toEqual([]);
  });
});

describe('chatEventSchema', () => {
  const events = [
    { type: 'meta', conversationId: id, userMessageId: id },
    { type: 'token', text: 'hel\nlo' },
    { type: 'done', messageId: id, kind: 'answer', content: 'x [S1]', citations: [citation] },
    { type: 'done', messageId: id, kind: 'no_answer', content: 'x', citations: [] },
    { type: 'error', code: 'llm_unavailable' },
    { type: 'error', code: 'internal' },
  ];

  it.each(events)('parses $type event', (event) => {
    expect(chatEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown type, extra keys, and bad enums', () => {
    expect(chatEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(chatEventSchema.safeParse({ type: 'token', text: 'a', extra: 1 }).success).toBe(false);
    expect(chatEventSchema.safeParse({ type: 'error', code: 'boom' }).success).toBe(false);
    expect(chatEventSchema.safeParse({ ...events[2], kind: 'other' }).success).toBe(false);
  });
});
