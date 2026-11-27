import { chatEventSchema, type ChatEvent } from '@hush/shared';

/** One SSE frame. Validates first so a malformed event can never reach the wire. */
export function sseFrame(event: ChatEvent): string {
  const e = chatEventSchema.parse(event);
  // JSON.stringify escapes newlines, so the payload always stays on one data line.
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
