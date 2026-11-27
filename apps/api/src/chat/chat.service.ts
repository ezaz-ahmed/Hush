import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ChatEvent } from '@hush/shared';
import { DB, type Db } from '../database/database.module.js';
import { EmbeddingError, type EmbeddingProvider } from '../embedding/embedding-provider.js';
import { LlmError, type LlmProvider } from '../llm/llm-provider.js';
import { buildAnswerPrompt, type AnswerSource } from '../prompts/answer-prompt.js';
import { NO_ANSWER_TEXT, NO_ANSWER_VERSION } from '../prompts/no-answer.js';
import { retrieve } from '../retrieval/retrieve.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './chat.tokens.js';
import { checkCitations } from './citations.js';
import { MessageRepository } from './message.repository.js';

export const ANSWER_MAX_TOKENS = 1024; // model config changes go through evals

const MAX_LOGGED_UNKNOWN_IDS = 10;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly messages: MessageRepository,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
  ) {}

  /**
   * Run before streaming so the controller can 404 pre-SSE. No id creates a conversation; an
   * unknown or not-owned id throws the same NotFoundException (ids cannot be probed).
   */
  async resolveConversation(userId: string, conversationId?: string): Promise<string> {
    if (!conversationId) return this.messages.createConversation(userId);
    const id = await this.messages.findOwnedConversation(conversationId, userId);
    if (!id) throw new NotFoundException();
    return id;
  }

  /**
   * Pipeline: store user message, meta, retrieve, (no chunks: fixed no-answer, no LLM), prompt,
   * stream, check citations, store assistant message, done. `message` must already be redacted
   * (#40). On abort it returns silently. Failures after `meta` become an `error` event carrying
   * a code only; logs carry the conversation id and error class, never content (rule 2).
   */
  async *handle(
    conversationId: string,
    message: string,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    try {
      const userMessageId = await this.messages.insertUserMessage(conversationId, message);
      yield { type: 'meta', conversationId, userMessageId };

      const found = await retrieve(this.db, this.embedder, message);
      if (signal.aborted) return;
      if (found.length === 0) {
        yield await this.finish(conversationId, NO_ANSWER_TEXT, [], null);
        return;
      }

      const prompt = buildAnswerPrompt(message, found);
      let reply = '';
      for await (const text of this.llm.stream({
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: ANSWER_MAX_TOKENS,
        signal,
      })) {
        if (signal.aborted) return;
        reply += text;
        yield { type: 'token', text };
      }
      if (signal.aborted) return;

      const check = checkCitations(reply, prompt.sources);
      if (check.grounded) {
        yield await this.finish(conversationId, reply, check.citations, prompt.promptVersion);
        return;
      }
      // digits are model output, so mask long ids (could be a phone/NRIC, or huge): rule 2
      this.logger.warn(
        `citation check failed conversation=${conversationId} reason=${check.reason} unknown=${check.unknownIds
          .slice(0, MAX_LOGGED_UNKNOWN_IDS)
          .map((id) => (id.length <= 4 ? id : 'S?'))
          .join(',')}`,
      );
      yield await this.finish(conversationId, NO_ANSWER_TEXT, [], null);
    } catch (err) {
      if (signal.aborted) return; // check before mapping: abort surfaces as LlmError
      this.logger.error(
        `chat failed conversation=${conversationId} error=${err instanceof Error ? err.name : 'unknown'}`,
      );
      yield {
        type: 'error',
        code:
          err instanceof LlmError || err instanceof EmbeddingError ? 'llm_unavailable' : 'internal',
      };
    }
  }

  /** Persists the assistant message (null version = the no-answer) and builds the `done` event. */
  private async finish(
    conversationId: string,
    content: string,
    used: AnswerSource[], // as cited; stored without the S# id, which only means something in one prompt
    promptVersion: string | null,
  ): Promise<ChatEvent> {
    const answered = promptVersion !== null;
    const messageId = await this.messages.insertAssistantMessage({
      conversationId,
      content,
      citations: used.map(({ chunkId, documentId, source }) => ({ chunkId, documentId, source })),
      promptVersion: promptVersion ?? NO_ANSWER_VERSION,
    });
    return {
      type: 'done',
      messageId,
      kind: answered ? 'answer' : 'no_answer',
      content,
      citations: used,
    };
  }
}
