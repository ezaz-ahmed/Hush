import { z } from 'zod';

export const CHAT_MESSAGE_MAX = 2000;

export const chatRequestSchema = z.strictObject({
  conversationId: z.uuid().optional(), // absent = new conversation
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatCitationSchema = z.strictObject({
  id: z.string().regex(/^S\d+$/), // as cited in the text, e.g. [S1]
  chunkId: z.uuid(),
  documentId: z.uuid(),
  source: z.string(),
});
export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('meta'), conversationId: z.uuid(), userMessageId: z.uuid() }),
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  z.strictObject({
    type: z.literal('done'),
    messageId: z.uuid(), // the persisted assistant message
    kind: z.enum(['answer', 'no_answer']),
    content: z.string(), // authoritative: replaces streamed tokens
    citations: z.array(chatCitationSchema), // empty when kind is 'no_answer'
  }),
  z.strictObject({ type: z.literal('error'), code: z.enum(['llm_unavailable', 'internal']) }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
