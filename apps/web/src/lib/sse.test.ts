import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@hush/shared';
import { readChatEvents, splitFrames } from './sse';

const enc = new TextEncoder();

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((x) => c.enqueue(x));
      c.close();
    },
  });

const collect = async (body: ReadableStream<Uint8Array>) => {
  const out: ChatEvent[] = [];
  for await (const e of readChatEvents(body)) out.push(e);
  return out;
};

const frame = (e: unknown, eol = '\n') => `event: x${eol}data: ${JSON.stringify(e)}${eol}${eol}`;

const meta = {
  type: 'meta',
  conversationId: '11111111-1111-4111-8111-111111111111',
  userMessageId: '22222222-2222-4222-8222-222222222222',
};
const token = { type: 'token', text: 'héllo 👋' };

describe('splitFrames', () => {
  it('returns complete frames and the remainder', () => {
    expect(splitFrames('a\n\nb\n\nc')).toEqual({ frames: ['a', 'b'], rest: 'c' });
  });
  it('handles CRLF', () => {
    expect(splitFrames('a\r\n\r\nb')).toEqual({ frames: ['a'], rest: 'b' });
  });
});

describe('readChatEvents', () => {
  it('yields one frame', async () => {
    expect(await collect(streamOf([enc.encode(frame(meta))]))).toEqual([meta]);
  });

  it('yields several frames from one chunk', async () => {
    expect(await collect(streamOf([enc.encode(frame(meta) + frame(token))]))).toEqual([
      meta,
      token,
    ]);
  });

  it('handles CRLF frames', async () => {
    expect(
      await collect(streamOf([enc.encode(frame(meta, '\r\n') + frame(token, '\r\n'))])),
    ).toEqual([meta, token]);
  });

  it('survives a split at every byte offset (incl. multi-byte chars)', async () => {
    const bytes = enc.encode(frame(meta) + frame(token, '\r\n'));
    for (let i = 1; i < bytes.length; i++) {
      const got = await collect(streamOf([bytes.slice(0, i), bytes.slice(i)]));
      expect(got).toEqual([meta, token]);
    }
  });

  it('drops a trailing partial frame', async () => {
    const partial = `data: ${JSON.stringify(token)}`;
    expect(await collect(streamOf([enc.encode(frame(meta) + partial)]))).toEqual([meta]);
  });

  it('ignores the event: line', async () => {
    const raw = `event: bogus\ndata: ${JSON.stringify(token)}\n\n`;
    expect(await collect(streamOf([enc.encode(raw)]))).toEqual([token]);
  });

  it('throws on invalid JSON', async () => {
    await expect(collect(streamOf([enc.encode('data: {nope\n\n')]))).rejects.toThrow();
  });

  it('throws on JSON that fails the schema', async () => {
    await expect(collect(streamOf([enc.encode(frame({ type: 'token' }))]))).rejects.toThrow();
  });

  it('throws on a frame with no data line', async () => {
    await expect(collect(streamOf([enc.encode('event: token\n\n')]))).rejects.toThrow();
  });

  it('yields nothing for an empty stream', async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});
