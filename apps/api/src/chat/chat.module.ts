import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { VoyageEmbeddingProvider } from '../embedding/voyage-embedding-provider.js';
import { AnthropicLlmProvider } from '../llm/anthropic-llm-provider.js';
import { chatThrottlers } from './chat-throttler.guard.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './chat.tokens.js';
import { MessageRepository } from './message.repository.js';

// Not imported into AppModule until redaction, consent and guardrails land (#40, #41, #49-#51).
@Module({
  imports: [
    DatabaseModule,
    // shortcut: counters are in memory per process, so N instances allow N x the limit; move to a shared store (Redis) if the API runs more than one instance.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // getOrThrow: a missing limit fails at boot instead of silently disabling throttling.
      useFactory: (config: ConfigService<Env, true>) =>
        chatThrottlers({
          perIp: config.getOrThrow('CHAT_RATE_LIMIT_PER_IP', { infer: true }),
          perUser: config.getOrThrow('CHAT_RATE_LIMIT_PER_USER', { infer: true }),
        }),
    }),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    MessageRepository,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        if (!apiKey) throw new Error('chat is not configured: LLM provider key missing');
        return new AnthropicLlmProvider({
          apiKey,
          model: config.get('ANTHROPIC_MODEL', { infer: true }),
        });
      },
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const apiKey = config.get('VOYAGE_API_KEY', { infer: true });
        if (!apiKey) throw new Error('chat is not configured: embedding provider key missing');
        return new VoyageEmbeddingProvider({ apiKey });
      },
    },
  ],
})
export class ChatModule {}
