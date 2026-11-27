import { chatEventSchema, type ChatEvent } from '@hush/shared';

/** Splits buffered text into complete SSE frames (blank-line separated, LF or CRLF) and the unfinished rest. */
export const splitFrames = (buffer: string): { frames: string[]; rest: string } => {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
};

// Only the data: line is read; its `type` is the source of truth. Errors never include frame content (PII).
const parseFrame = (frame: string): ChatEvent => {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n');
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error('Invalid SSE frame');
  }
  const parsed = chatEventSchema.safeParse(json);
  if (!parsed.success) throw new Error('Invalid chat event');
  return parsed.data;
};

/** Yields validated chat events; throws on an invalid frame; a trailing partial frame is dropped. */
export async function* readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const { frames, rest } = splitFrames(buffer + decoder.decode(value, { stream: true }));
      buffer = rest;
      for (const f of frames) yield parseFrame(f);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
