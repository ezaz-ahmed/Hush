import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@hush/shared';
import { ChatController } from './chat.controller.js';
import type { ChatService } from './chat.service.js';

const SECRET = 'marker-7f3a';

class FakeRaw extends EventEmitter {
  destroyed = false;
  writable = true;
  written: string[] = [];
  head: { status: number; headers: Record<string, string> } | undefined;
  ended = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.head = { status, headers };
  }
  write(chunk: string) {
    this.written.push(chunk);
  }
  end() {
    this.ended = true;
  }
}

const run = async (raw: FakeRaw, handle: ChatService['handle']) => {
  const service = {
    resolveConversation: () => Promise.resolve('conv-1'),
    handle,
  } as unknown as ChatService;
  const reply = {
    hijack: () => undefined,
    raw,
    getHeaders: () => ({ 'x-test': '1' }),
  } as unknown as FastifyReply;
  await new ChatController(service).post({ message: 'hi' }, 'user-1', reply);
};

describe('ChatController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aborts when the client already dropped before the listener was attached', async () => {
    const raw = new FakeRaw();
    raw.destroyed = true;
    let abortedAtStart: boolean | undefined;
    // eslint-disable-next-line require-yield -- records the signal only
    await run(raw, async function* (_c, _m, signal) {
      abortedAtStart = signal.aborted;
    });
    expect(abortedAtStart).toBe(true);
  });

  it('sends an internal error frame and ends when writing an event throws, logging no content', async () => {
    const raw = new FakeRaw();
    const logs = [vi.spyOn(Logger.prototype, 'error'), vi.spyOn(console, 'error')];
    await run(raw, async function* () {
      yield { type: 'token', text: 1, secret: SECRET } as unknown as ChatEvent; // fails sseFrame validation
    });
    expect(raw.written).toEqual(['event: error\ndata: {"type":"error","code":"internal"}\n\n']);
    expect(raw.ended).toBe(true);
    expect(logs.some((s) => s.mock.calls.length > 0)).toBe(true);
    expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(SECRET);
  });

  it('does not write the error frame when the socket is no longer writable', async () => {
    const raw = new FakeRaw();
    raw.writable = false;
    await run(raw, async function* () {
      yield { type: 'token', text: 1 } as unknown as ChatEvent;
    });
    expect(raw.written).toEqual([]);
    expect(raw.ended).toBe(true);
  });

  it('keeps hook headers, sets SSE headers, and omits connection', async () => {
    const raw = new FakeRaw();
    await run(raw, async function* () {});
    expect(raw.head?.headers).toEqual({
      'x-test': '1',
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
  });
});
