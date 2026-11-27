import type { OutgoingHttpHeaders } from 'node:http';
import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { chatRequestSchema, type ChatRequest } from '@hush/shared';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ChatUserId } from './chat-user.decorator.js';
import { ChatService } from './chat.service.js';
import { sseFrame } from './sse.js';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  async post(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @ChatUserId() userId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Before hijack, so an unknown or not-owned id is a normal JSON 404.
    const conversationId = await this.chat.resolveConversation(userId, body.conversationId);

    reply.hijack();
    const { raw } = reply;
    raw.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders), // hijack skips Fastify's header flush; keep onRequest-hook headers
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
    const ac = new AbortController();
    let finished = false;
    raw.on('close', () => {
      if (!finished) ac.abort();
    });
    if (raw.destroyed) ac.abort(); // client dropped before the listener existed
    try {
      for await (const event of this.chat.handle(conversationId, body.message, ac.signal)) {
        if (ac.signal.aborted) break;
        raw.write(sseFrame(event));
      }
    } catch (err) {
      // Reply is hijacked: never rethrow. Class name and conversation id only (rule 2).
      this.logger.error(
        `chat stream failed conversation=${conversationId} error=${err instanceof Error ? err.name : 'unknown'}`,
      );
      if (raw.writable) raw.write(sseFrame({ type: 'error', code: 'internal' }));
    } finally {
      finished = true;
      raw.end();
    }
  }
}
