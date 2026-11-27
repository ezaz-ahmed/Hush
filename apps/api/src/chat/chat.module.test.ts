import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../database/database.module.js';
import { VoyageEmbeddingProvider } from '../embedding/voyage-embedding-provider.js';
import { AnthropicLlmProvider } from '../llm/anthropic-llm-provider.js';
import { ChatModule } from './chat.module.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './chat.tokens.js';

const compile = () =>
  Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }), ChatModule],
  })
    .overrideProvider(DB)
    .useValue({})
    .compile();

describe('ChatModule provider factories', () => {
  // No zod env validation here, so the model default is not applied.
  beforeEach(() => vi.stubEnv('ANTHROPIC_MODEL', 'test-model'));
  afterEach(() => vi.unstubAllEnvs());

  it('throws a generic error without ANTHROPIC_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('VOYAGE_API_KEY', 'voyage-secret-value');
    const err = await compile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('chat is not configured: LLM provider key missing');
    expect((err as Error).message).not.toContain('voyage-secret-value');
  });

  it('throws a generic error without VOYAGE_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-secret-value');
    vi.stubEnv('VOYAGE_API_KEY', '');
    const err = await compile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('chat is not configured: embedding provider key missing');
    expect((err as Error).message).not.toContain('anthropic-secret-value');
  });

  it('builds the real providers when both keys are set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'a-key');
    vi.stubEnv('VOYAGE_API_KEY', 'v-key');
    const mod = await compile();
    expect(mod.get(LLM_PROVIDER)).toBeInstanceOf(AnthropicLlmProvider);
    expect(mod.get(EMBEDDING_PROVIDER)).toBeInstanceOf(VoyageEmbeddingProvider);
  });
});
